import type { ClientChannel } from 'ssh2'
import type { ChatEvent } from '@shared/ipc'
import { acpCmd } from '../connection/remote'
import { JsonRpc, RpcError } from './rpc'

type Emit = (e: { kind: ChatEvent['kind'] } & Record<string, unknown>) => void

export interface AcpDeps {
  conn: { openDuplex(argv: readonly string[]): Promise<ClientChannel> }
  hermes: string
  /** The folder the agent works in (ACP wants one): the home of the server user. */
  cwd: () => string
  log?: (msg: string) => void
  /** How long a cancelled turn may take to end on its own before the process is closed. */
  stopGraceMs?: number
}

/** What a running turn hands back to the chat service. */
export interface AcpTurn {
  /** Asks Hermes to stop; open approvals are cancelled. */
  cancel(): void
  approve(approval: string, option: string | null): boolean
  /** Closes the process (the connection is going away). */
  kill(): void
  done: Promise<void>
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** Text of a content block as ACP sends it: `{type:'text', text}`, a bare `{text}`, a plain string, or a list of those. */
function textOf(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(textOf).join('')
  if (isObj(c) && (c['type'] === undefined || c['type'] === 'text') && typeof c['text'] === 'string') return c['text']
  return ''
}

/** The command or arguments of a tool call, short enough to read in a card. */
function describe(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.slice(0, 800)
  if (!isObj(raw)) return undefined
  const cmd = str(raw['command']) ?? str(raw['cmd']) ?? str(raw['path'])
  if (cmd) return cmd.slice(0, 800)
  try {
    return JSON.stringify(raw).slice(0, 800)
  } catch {
    return undefined
  }
}

interface Pending {
  resolve(v: unknown): void
  options: { id: string; kind: 'allow' | 'deny'; name: string }[]
}

interface Running {
  turn: string
  emit: Emit
  startedAt: number
  /** Start time and name of each tool call (updates may leave the name out). */
  tools: Map<string, { at: number; name: string }>
  approvals: Map<string, Pending>
  cancelled: boolean
  /** What came in, for the log and for noticing a turn that ended without a reply. */
  textChars: number
  errored: boolean
  updates: Map<string, number>
}

/** One `hermes acp` process, kept open between messages of one agent. */
export class AcpAgent {
  private rpc: JsonRpc | null = null
  private sessionId: string | null = null
  private loadSession = false
  private running: Running | null = null
  private counter = 0
  private killTimer: NodeJS.Timeout | null = null
  onExit: () => void = () => {}

  constructor(
    private readonly d: AcpDeps,
    private readonly profile: string
  ) {}

  get alive(): boolean {
    return this.rpc !== null && !this.rpc.isClosed
  }

  get busy(): boolean {
    return this.running !== null
  }

  kill(): void {
    this.rpc?.close()
  }

  async start(): Promise<void> {
    const ch = await this.d.conn.openDuplex(acpCmd(this.d.hermes, this.profile))
    this.rpc = new JsonRpc(ch, {
      notification: (m, p) => this.onNotification(m, p),
      request: (m, p) => this.onRequest(m, p),
      closed: () => this.onClosed()
    })
    const res = await this.rpc.request(
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'mission-control', title: 'Hermes Agent Mission Control', version: '0.1.0' }
      },
      25_000
    )
    const caps = isObj(res) && isObj(res['agentCapabilities']) ? res['agentCapabilities'] : {}
    this.loadSession = caps['loadSession'] === true
    const info = isObj(res) && isObj(res['agentInfo']) ? res['agentInfo'] : {}
    this.d.log?.(`acp: initialized (${this.profile}) protocol=${isObj(res) ? String(res['protocolVersion'] ?? '?') : '?'} agent=${str(info['name']) ?? '?'} ${str(info['version']) ?? ''} loadSession=${this.loadSession}`)
  }

  /** Makes sure there is a session to talk in: the saved one if it can be loaded, a new one otherwise. */
  private async ensureSession(saved: string | null): Promise<{ id: string; fresh: boolean }> {
    const rpc = this.rpc!
    if (this.sessionId && (saved === null ? false : saved === this.sessionId)) return { id: this.sessionId, fresh: false }
    const cwd = this.d.cwd()
    if (saved && this.loadSession) {
      try {
        await rpc.request('session/load', { sessionId: saved, cwd, mcpServers: [] }, 25_000)
        this.sessionId = saved
        return { id: saved, fresh: false }
      } catch (e) {
        this.d.log?.(`acp: session/load failed (${e instanceof Error ? e.message : String(e)}), starting a new session`)
      }
    }
    const res = await rpc.request('session/new', { cwd, mcpServers: [] }, 25_000)
    const id = isObj(res) ? str(res['sessionId']) : undefined
    if (!id) throw new Error('Hermes did not return a session.')
    this.sessionId = id
    return { id, fresh: true }
  }

  /** Sends one message and reports what happens through `emit` (same events as the one-shot chat). */
  async turn(turn: string, message: string, saved: string | null, emit: Emit, begin: (sessionId: string) => void): Promise<AcpTurn> {
    if (!this.alive) throw new Error('Hermes ACP is not running.')
    const { id } = await this.ensureSession(saved)
    begin(id)
    const run: Running = { turn, emit, startedAt: Date.now(), tools: new Map(), approvals: new Map(), cancelled: false, textChars: 0, errored: false, updates: new Map() }
    this.running = run
    const rpc = this.rpc!
    const done = (async () => {
      let stopReason = ''
      try {
        const res = await rpc.request('session/prompt', { sessionId: id, prompt: [{ type: 'text', text: message }] }, 0)
        stopReason = isObj(res) ? (str(res['stopReason']) ?? '') : ''
      } catch (e) {
        if (!run.cancelled) {
          run.errored = true
          emit({ kind: 'error', message: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
        }
      }
      this.settle(run)
      if (this.killTimer) {
        clearTimeout(this.killTimer)
        this.killTimer = null
      }
      if (this.running === run) this.running = null
      const stopped = run.cancelled || stopReason === 'cancelled'
      const kinds = [...run.updates].map(([k, n]) => `${k}:${n}`).join(',') || 'none'
      this.d.log?.(`acp: turn ended (${this.profile}) stopReason=${stopReason || '-'} text=${run.textChars} updates=${kinds} ms=${Date.now() - run.startedAt}`)
      if (!stopped && !run.errored && run.textChars === 0) {
        emit({ kind: 'error', message: `Hermes ended the turn without a reply${stopReason ? ` (${stopReason})` : ''}. It sent: ${kinds === 'none' ? 'nothing' : kinds}. Try again, or turn off “Ask before risky actions” in Settings → Chat to use the one-shot chat.` })
      }
      if (!stopped) emit({ kind: 'result', exitCode: 0, durationMs: Date.now() - run.startedAt })
      emit({ kind: 'end', exitCode: stopped ? null : 0, stopped })
    })()
    return {
      done,
      cancel: () => this.cancel(run),
      approve: (approval, option) => this.answer(run, approval, option),
      kill: () => this.rpc?.close()
    }
  }

  private cancel(run: Running): void {
    if (run.cancelled || this.running !== run) return
    run.cancelled = true
    if (this.sessionId) this.rpc?.notify('session/cancel', { sessionId: this.sessionId })
    this.settle(run)
    // if Hermes does not wind down by itself the process is closed, and the next message starts a new one
    this.killTimer = setTimeout(() => this.rpc?.close(), this.d.stopGraceMs ?? 4000)
    this.killTimer.unref()
  }

  /** Open approvals are cancelled when the turn ends or is stopped, so nothing keeps waiting. */
  private settle(run: Running): void {
    for (const [id, p] of run.approvals) {
      p.resolve({ outcome: { outcome: 'cancelled' } })
      run.emit({ kind: 'approval-done', id, outcome: 'cancelled' })
    }
    run.approvals.clear()
  }

  private answer(run: Running, approval: string, option: string | null): boolean {
    const p = run.approvals.get(approval)
    if (!p || this.running !== run) return false
    run.approvals.delete(approval)
    const chosen = option === null ? undefined : p.options.find((o) => o.id === option)
    if (option !== null && !chosen) {
      run.approvals.set(approval, p)
      return false
    }
    if (chosen) {
      p.resolve({ outcome: { outcome: 'selected', optionId: chosen.id } })
      run.emit({ kind: 'approval-done', id: approval, outcome: chosen.kind === 'allow' ? 'allowed' : 'denied', choice: chosen.name })
    } else {
      p.resolve({ outcome: { outcome: 'cancelled' } })
      run.emit({ kind: 'approval-done', id: approval, outcome: 'cancelled' })
    }
    return true
  }

  private onNotification(method: string, params: unknown): void {
    const run = this.running
    if (method !== 'session/update' || !run || !isObj(params) || !isObj(params['update'])) return
    if (typeof params['sessionId'] === 'string' && this.sessionId && params['sessionId'] !== this.sessionId) return
    const u = params['update']
    const kind = str(u['sessionUpdate'])
    run.updates.set(kind ?? '?', (run.updates.get(kind ?? '?') ?? 0) + 1)
    if (kind === 'agent_message_chunk') {
      const t = textOf(u['content'])
      if (t !== '') {
        run.textChars += t.length
        run.emit({ kind: 'text', text: t })
      }
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      const id = str(u['toolCallId'])
      if (!id) return
      const known = run.tools.get(id)
      const name = (str(u['title']) ?? known?.name ?? str(u['kind']) ?? 'tool').slice(0, 80)
      const status = str(u['status'])
      if (!known || known.name !== name) run.tools.set(id, { at: known?.at ?? Date.now(), name })
      const ms = Date.now() - run.tools.get(id)!.at
      if (status === 'completed') run.emit({ kind: 'tool', id, name, state: 'ok', ms })
      else if (status === 'failed') run.emit({ kind: 'tool', id, name, state: 'error', ms })
      else run.emit({ kind: 'tool', id, name, state: 'running' })
    }
  }

  private async onRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== 'session/request_permission') throw new RpcError(-32601, `Method not found: ${method}`)
    const run = this.running
    if (!run || !isObj(params)) return { outcome: { outcome: 'cancelled' } }
    const call = isObj(params['toolCall']) ? params['toolCall'] : {}
    const raw = Array.isArray(params['options']) ? params['options'] : []
    const options = raw.flatMap((o) => {
      if (!isObj(o)) return []
      const id = str(o['optionId'])
      if (!id) return []
      const k = str(o['kind']) ?? ''
      return [{ id, name: (str(o['name']) ?? id).slice(0, 60), kind: k.startsWith('reject') ? ('deny' as const) : ('allow' as const) }]
    })
    if (options.length === 0) return { outcome: { outcome: 'cancelled' } }
    const approvalId = `ap${++this.counter}`
    const title = (str(call['title']) ?? str(call['kind']) ?? 'Run a tool').slice(0, 200)
    const detail = describe(call['rawInput'])
    return new Promise((resolve) => {
      run.approvals.set(approvalId, { resolve, options })
      run.emit({ kind: 'approval', id: approvalId, title, ...(detail ? { detail } : {}), options })
    })
  }

  private onClosed(): void {
    // a turn in flight sees its request fail and reports the error and the end itself
    this.sessionId = null
    this.onExit()
  }
}

/** The ACP processes of one connection, one per agent. */
export class AcpHub {
  private agents = new Map<string, AcpAgent>()

  constructor(private readonly d: AcpDeps) {}

  async agent(profile: string): Promise<AcpAgent> {
    let a = this.agents.get(profile)
    if (a && a.alive) return a
    a = new AcpAgent(this.d, profile)
    const made = a
    made.onExit = () => {
      if (this.agents.get(profile) === made) this.agents.delete(profile)
    }
    try {
      await made.start()
    } catch (e) {
      made.onExit()
      throw e
    }
    this.agents.set(profile, made)
    return made
  }

  dispose(): void {
    for (const a of this.agents.values()) a.onExit = () => {}
    for (const a of this.agents.values()) a.kill()
    this.agents.clear()
  }
}
