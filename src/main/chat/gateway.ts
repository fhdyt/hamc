import type { ClientChannel } from 'ssh2'
import type { ChatEvent } from '@shared/ipc'
import { gatewayCmd } from '../connection/remote'
import { JsonRpc, RpcError } from './rpc'

/*
 * Chat through Hermes's own TUI gateway (`python -m tui_gateway.entry`), the JSON-RPC backend `hermes serve` offers on
 * /api/ws, here over one SSH channel instead of a port. One process serves every profile and stays up between
 * messages, so a message no longer pays for starting Hermes and building the agent. Protocol as in Hermes v0.21.0
 * (tui_gateway/server.py, methods_session.py, methods_prompt.py): `gateway.ready` first, `session.create|resume`,
 * `prompt.submit` (answers at once; the turn streams as `event` notifications), `session.interrupt`,
 * `approval.respond`, `clarify.respond`.
 */

type Emit = (e: { kind: ChatEvent['kind'] } & Record<string, unknown>) => void

export interface GatewayDeps {
  conn: { openDuplex(argv: readonly string[]): Promise<ClientChannel> }
  python: string
  home: string
  log?: (msg: string) => void
  /** How long a stopped turn may take to end before it is reported as stopped anyway. */
  stopGraceMs?: number
  /** How long the gateway may take to say it is ready. */
  readyTimeoutMs?: number
}

export interface GatewayTurn {
  cancel(): void
  approve(approval: string, option: string | null): boolean
  /** The connection is going away: the turn ends as stopped. */
  kill(): void
  done: Promise<void>
}

/** The source the app's sessions get in state.db, as with the one-shot chat. */
export const GATEWAY_SOURCE = 'mission-control'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const CHOICE_LABEL: Record<string, string> = { once: 'Allow once', session: 'Allow for this session', always: 'Always allow', deny: 'Deny' }

/** The gateway's approval choices as the approval card shows them; `deny` is the only Deny. */
export function approvalOptions(choices: unknown): { id: string; name: string; kind: 'allow' | 'deny' }[] {
  const list = Array.isArray(choices) ? choices.filter((c): c is string => typeof c === 'string' && /^[a-z_]{1,20}$/.test(c)) : []
  const use = list.length > 0 ? list : ['once', 'deny']
  return use.map((c) => ({ id: c, name: CHOICE_LABEL[c] ?? c, kind: c === 'deny' ? ('deny' as const) : ('allow' as const) }))
}

/** Tokens of one turn from the session's running totals (`message.complete` carries totals, not the turn's). */
export function turnTokens(prev: { input: number; output: number } | null, usage: unknown): { inputTokens?: number; outputTokens?: number; next: { input: number; output: number } | null } {
  if (!isObj(usage)) return { next: prev }
  const input = num(usage['input']) ?? num(usage['prompt'])
  const output = num(usage['output']) ?? num(usage['completion'])
  if (input === undefined || output === undefined) return { next: prev }
  const next = { input, output }
  if (prev === null || input < prev.input || output < prev.output) return { next }
  return { inputTokens: input - prev.input, outputTokens: output - prev.output, next }
}

interface Pending {
  kind: 'approval' | 'clarify'
  requestId: string
  options: { id: string; name: string; kind: 'allow' | 'deny' }[]
}

interface Running {
  turn: string
  runtime: string
  emit: Emit
  startedAt: number
  tools: Map<string, { name: string; at: number }>
  pending: Map<string, Pending>
  textChars: number
  stopped: boolean
  errored: boolean
  finish: (status: string, usage?: unknown) => void
  timer: NodeJS.Timeout | null
}

interface Sess {
  runtime: string
  stored: string
  /** Running token totals of the session, once known. */
  usage: { input: number; output: number } | null
}

export class TuiGateway {
  private rpc: JsonRpc | null = null
  private readyWait: { resolve(): void; reject(e: Error): void } | null = null
  private sessions = new Map<string, Sess>()
  private running = new Map<string, Running>()
  private counter = 0
  /** Profiles the gateway would not open (it fell back to the launch profile). */
  private refused = new Set<string>()
  onExit: () => void = () => {}

  constructor(private readonly d: GatewayDeps) {}

  get alive(): boolean {
    return this.rpc !== null && !this.rpc.isClosed
  }

  refuses(profile: string): boolean {
    return this.refused.has(profile)
  }

  busy(profile: string): boolean {
    const s = this.sessions.get(profile)
    return !!s && this.running.has(s.runtime)
  }

  async start(): Promise<void> {
    const ch = await this.d.conn.openDuplex(gatewayCmd(this.d.python, this.d.home))
    const ready = new Promise<void>((resolve, reject) => {
      this.readyWait = { resolve, reject }
    })
    this.rpc = new JsonRpc(ch, {
      notification: (m, p) => this.onNotification(m, p),
      request: async (m) => {
        throw new RpcError(-32601, `Method not found: ${m}`)
      },
      closed: () => this.onClosed()
    })
    const t = setTimeout(() => this.readyWait?.reject(new Error('The Hermes gateway did not get ready in time.')), this.d.readyTimeoutMs ?? 90_000)
    try {
      await ready
    } finally {
      clearTimeout(t)
      this.readyWait = null
    }
    this.d.log?.('gateway: ready')
  }

  /** The session of this profile: the one in memory, the saved one resumed, or a new one. */
  private async session(profile: string, saved: string | null): Promise<{ s: Sess; fresh: boolean }> {
    const rpc = this.rpc!
    const have = this.sessions.get(profile)
    if (have && saved !== null && have.stored === saved) return { s: have, fresh: false }
    const scope = profile === 'default' ? {} : { profile }
    if (saved !== null) {
      try {
        const res = await rpc.request('session.resume', { session_id: saved, ...scope, omit_messages: true }, 120_000)
        const s = this.adopt(profile, res, saved)
        if (s) return { s, fresh: false }
      } catch (e) {
        // an unknown id answers 4007; anything else is reported too, and a new session starts
        this.d.log?.(`gateway: resume of the saved session failed (${profile}): ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const res = await rpc.request('session.create', { source: GATEWAY_SOURCE, ...scope }, 120_000)
    const s = this.adopt(profile, res, null)
    if (!s) throw new Error('Hermes did not return a session.')
    // a new session starts from zero, so its first turn's tokens are known; a resumed one learns its totals first
    s.usage = { input: 0, output: 0 }
    return { s, fresh: true }
  }

  private adopt(profile: string, res: unknown, fallbackStored: string | null): Sess | null {
    if (!isObj(res)) return null
    const runtime = str(res['session_id'])
    const info = isObj(res['info']) ? res['info'] : {}
    const stored = str(res['stored_session_id']) ?? str(info['stored_session_id']) ?? str(res['resumed']) ?? fallbackStored
    if (!runtime || !stored) return null
    const opened = str(info['profile_name'])
    if (profile !== 'default' && opened !== undefined && opened !== profile) {
      // Hermes falls back to its launch profile for a profile it cannot find: never talk to the wrong agent
      this.refused.add(profile)
      throw new Error(`Hermes opened the profile “${opened}” instead of “${profile}”.`)
    }
    const s: Sess = { runtime, stored, usage: null }
    this.sessions.set(profile, s)
    return s
  }

  /** Sends one message; what happens comes back through `emit`, as with ACP and the one-shot chat. */
  async turn(turn: string, profile: string, message: string, saved: string | null, emit: Emit, begin: (storedId: string) => void): Promise<GatewayTurn> {
    if (!this.alive) throw new Error('The Hermes gateway is not running.')
    const { s } = await this.session(profile, saved)
    emit({ kind: 'start', mode: 'gateway' })
    begin(s.stored)
    let resolveDone: () => void = () => {}
    const done = new Promise<void>((r) => {
      resolveDone = r
    })
    const run: Running = {
      turn,
      runtime: s.runtime,
      emit,
      startedAt: Date.now(),
      tools: new Map(),
      pending: new Map(),
      textChars: 0,
      stopped: false,
      errored: false,
      timer: null,
      finish: () => {}
    }
    let finished = false
    run.finish = (status: string, usage?: unknown) => {
      if (finished) return
      finished = true
      if (run.timer) clearTimeout(run.timer)
      this.running.delete(s.runtime)
      this.settle(run)
      const stopped = run.stopped || status === 'interrupted'
      if (!stopped && !run.errored && run.textChars === 0) {
        run.errored = true
        emit({ kind: 'error', message: status === 'error' ? 'Hermes reported an error.' : 'Hermes finished without a reply.' })
      }
      if (!stopped) {
        const tokens = turnTokens(s.usage, usage)
        s.usage = tokens.next
        emit({
          kind: 'result',
          exitCode: status === 'complete' ? 0 : null,
          durationMs: Date.now() - run.startedAt,
          ...(tokens.inputTokens !== undefined ? { inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens } : {})
        })
      }
      this.d.log?.(`gateway: turn ended (${profile}) status=${status} text=${run.textChars} stopped=${stopped} ms=${Date.now() - run.startedAt}`)
      emit({ kind: 'end', exitCode: stopped ? null : status === 'complete' ? 0 : 1, stopped })
      resolveDone()
    }
    this.running.set(s.runtime, run)
    try {
      const res = await this.rpc!.request('prompt.submit', { session_id: s.runtime, text: message }, 60_000)
      const status = isObj(res) ? str(res['status']) : undefined
      if (status && status !== 'streaming') this.d.log?.(`gateway: prompt.submit answered ${status} (${profile})`)
    } catch (e) {
      run.errored = true
      emit({ kind: 'error', message: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
      // a session Hermes no longer holds is dropped, so the next message resumes or starts one
      if (this.sessions.get(profile) === s) this.sessions.delete(profile)
      run.finish('error')
    }
    return {
      done,
      cancel: () => this.cancel(run),
      approve: (approval, option) => this.answer(run, approval, option),
      kill: () => {
        run.stopped = true
        run.finish('interrupted')
      }
    }
  }

  private cancel(run: Running): void {
    if (run.stopped || !this.running.has(run.runtime)) return
    run.stopped = true
    this.settle(run)
    void this.rpc?.request('session.interrupt', { session_id: run.runtime }, 15_000).catch(() => undefined)
    // the gateway answers with message.complete (interrupted); if it does not, the turn ends here anyway
    run.timer = setTimeout(() => run.finish('interrupted'), this.d.stopGraceMs ?? 8000)
    run.timer.unref()
  }

  /** Open questions are answered "deny" (approvals) or left to expire (clarify) when the turn ends or is stopped. */
  private settle(run: Running): void {
    for (const [id, p] of run.pending) {
      if (p.kind === 'approval') void this.rpc?.request('approval.respond', { session_id: run.runtime, choice: 'deny', request_id: p.requestId }, 15_000).catch(() => undefined)
      run.emit({ kind: 'approval-done', id, outcome: 'cancelled' })
    }
    run.pending.clear()
  }

  private answer(run: Running, approval: string, option: string | null): boolean {
    const p = run.pending.get(approval)
    if (!p || !this.running.has(run.runtime)) return false
    const chosen = option === null ? undefined : p.options.find((o) => o.id === option)
    if (option !== null && !chosen) return false
    run.pending.delete(approval)
    if (p.kind === 'approval') {
      // no choice (Cancel) is a deny: Hermes never runs what was not approved
      const choice = chosen?.id ?? 'deny'
      void this.rpc?.request('approval.respond', { session_id: run.runtime, choice, request_id: p.requestId }, 15_000).catch(() => undefined)
      run.emit({ kind: 'approval-done', id: approval, outcome: chosen ? (chosen.kind === 'allow' ? 'allowed' : 'denied') : 'cancelled', ...(chosen ? { choice: chosen.name } : {}) })
    } else {
      if (chosen) void this.rpc?.request('clarify.respond', { request_id: p.requestId, answer: chosen.name }, 15_000).catch(() => undefined)
      run.emit({ kind: 'approval-done', id: approval, outcome: chosen ? 'allowed' : 'cancelled', ...(chosen ? { choice: chosen.name } : {}) })
    }
    return true
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== 'event' || !isObj(params)) return
    const type = str(params['type'])
    const payload = isObj(params['payload']) ? params['payload'] : {}
    if (type === 'gateway.ready') {
      this.readyWait?.resolve()
      return
    }
    const sid = str(params['session_id'])
    if (type === 'session.info' && sid) {
      // the stored id rotates after a compression; keep following it
      const stored = str(payload['stored_session_id'])
      for (const s of this.sessions.values()) if (s.runtime === sid && stored) s.stored = stored
      return
    }
    const run = sid ? this.running.get(sid) : undefined
    if (!run) return
    const e = run.emit
    switch (type) {
      case 'message.delta': {
        const t = typeof payload['text'] === 'string' ? payload['text'] : ''
        if (t !== '') {
          run.textChars += t.length
          e({ kind: 'text', text: t })
        }
        return
      }
      case 'tool.start': {
        const id = str(payload['tool_id']) ?? `t${++this.counter}`
        const name = (str(payload['name']) ?? 'tool').slice(0, 80)
        run.tools.set(id, { name, at: Date.now() })
        e({ kind: 'tool', id, name, state: 'running' })
        return
      }
      case 'tool.complete': {
        const id = str(payload['tool_id']) ?? `t${++this.counter}`
        const known = run.tools.get(id)
        const name = (str(payload['name']) ?? known?.name ?? 'tool').slice(0, 80)
        const secs = num(payload['duration_s'])
        const ms = secs !== undefined ? Math.round(secs * 1000) : known ? Date.now() - known.at : undefined
        const result = payload['result']
        const failed = str(payload['error']) !== undefined || (isObj(result) && (result['error'] !== undefined && result['error'] !== null && result['error'] !== false))
        e({ kind: 'tool', id, name, state: failed ? 'error' : 'ok', ...(ms !== undefined ? { ms } : {}) })
        return
      }
      case 'approval.request': {
        const requestId = str(payload['request_id']) ?? ''
        const options = approvalOptions(payload['choices'])
        const id = `ga${++this.counter}`
        run.pending.set(id, { kind: 'approval', requestId, options })
        const detail = str(payload['command'])
        e({ kind: 'approval', id, title: (str(payload['description']) ?? 'Run a command').slice(0, 200), ...(detail ? { detail: detail.slice(0, 800) } : {}), options })
        return
      }
      case 'clarify.request': {
        const requestId = str(payload['request_id']) ?? ''
        const choices = Array.isArray(payload['choices']) ? payload['choices'].filter((c): c is string => typeof c === 'string').slice(0, 8) : []
        const question = (str(payload['question']) ?? 'Hermes has a question').slice(0, 300)
        if (choices.length === 0) {
          e({ kind: 'notice', code: 'blocked', message: `Hermes asks: ${question} Typed answers are not supported here; stop the turn and answer in a new message.` })
          return
        }
        const id = `gq${++this.counter}`
        const options = choices.map((c, i) => ({ id: `c${i}`, name: c.slice(0, 60), kind: 'allow' as const }))
        run.pending.set(id, { kind: 'clarify', requestId, options })
        e({ kind: 'approval', id, title: question, options })
        return
      }
      case 'clarify.expire': {
        const requestId = str(payload['request_id'])
        for (const [id, p] of run.pending) {
          if (p.kind === 'clarify' && p.requestId === requestId) {
            run.pending.delete(id)
            e({ kind: 'approval-done', id, outcome: 'cancelled' })
          }
        }
        return
      }
      case 'secret.request':
      case 'sudo.request':
        // a secret or a sudo password never goes through Mission Control
        e({ kind: 'notice', code: 'blocked', message: `Hermes asks for ${type === 'sudo.request' ? 'a sudo password' : `a secret${str(payload['env_var']) ? ` (${str(payload['env_var'])})` : ''}`}. Mission Control never sends one; set it in the terminal, then stop this turn.` })
        return
      case 'error': {
        run.errored = true
        e({ kind: 'error', message: (str(payload['message']) ?? 'Hermes reported an error.').slice(0, 500) })
        return
      }
      case 'message.complete': {
        const status = str(payload['status']) ?? 'complete'
        const text = typeof payload['text'] === 'string' ? payload['text'] : ''
        if (run.textChars === 0 && text !== '' && status !== 'interrupted') {
          run.textChars += text.length
          e({ kind: 'text', text })
        }
        if (status === 'error' && !run.errored) {
          run.errored = true
          e({ kind: 'error', message: (str(payload['error']) ?? 'Hermes reported an error.').slice(0, 500) })
        }
        run.finish(status, payload['usage'])
        return
      }
    }
  }

  private onClosed(): void {
    this.readyWait?.reject(new Error(this.rpc?.stderrTail() || 'The Hermes gateway ended before it was ready.'))
    for (const run of [...this.running.values()]) {
      if (!run.stopped) {
        run.errored = true
        run.emit({ kind: 'error', message: `The Hermes gateway stopped.${this.rpc?.stderrTail() ? ` ${this.rpc.stderrTail()}` : ''}`.slice(0, 500) })
      }
      run.finish('error')
    }
    this.sessions.clear()
    this.onExit()
  }

  /** Ends the gateway: stdin is closed, so Hermes saves its sessions and exits by itself. */
  dispose(): void {
    for (const run of [...this.running.values()]) {
      run.stopped = true
      run.finish('interrupted')
    }
    this.onExit = () => {}
    this.rpc?.end()
  }
}
