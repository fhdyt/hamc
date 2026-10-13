import { spawn } from 'node:child_process'
import type { ServerChannel } from 'ssh2'
import { pythonExe } from './fixture'

/** What the fake Hermes keeps between commands, and what tests can look at. */
export interface FakeHermesState {
  /** Values of `hermes config set <dotted.key> <value>` per profile. */
  config: Map<string, Record<string, string>>
  /** Values of `hermes config set <ENV_VAR> <key>` per profile (the fake .env). */
  env: Map<string, Record<string, string>>
  /** How each key reached the fake: on stdin or as an argument. */
  keyVia: ('stdin' | 'argument')[]
  /** Profiles whose gateway was restarted. */
  restarts: string[]
  /** Profiles whose gateway was stopped. */
  stops: string[]
  /** `config set` of these keys fails with this message. The key `sessions` fails `hermes sessions pin|unpin|rename`. */
  failOn: Record<string, string>
  /** Every `hermes sessions pin|unpin|rename` call, as the arguments after `hermes`. */
  sessionCalls: string[][]
  /** Every `hermes cron ...` call, as the arguments after `hermes`. */
  cronCalls: string[][]
  /** Every `hermes curator ...` and `hermes skills ...` call, as the arguments after `hermes`. */
  skillCalls: string[][]
  /** Every `hermes mcp|tools|fallback|profile ...` call, as the arguments after `hermes`. */
  opsCalls: string[][]
  /** Every launch of the TUI gateway, as the full command line (`env VAR=… python -P -m tui_gateway.entry`). */
  gatewayLaunches: string[][]
  /** Every JSON-RPC request the app sent to the gateway. */
  gatewayCalls: { method: string; params: Record<string, unknown> }[]
}

export const newHermesState = (): FakeHermesState => ({ config: new Map(), env: new Map(), keyVia: [], restarts: [], stops: [], failOn: {}, sessionCalls: [], cronCalls: [], skillCalls: [], opsCalls: [], gatewayLaunches: [], gatewayCalls: [] })

export interface FakeHermesOptions {
  st: FakeHermesState
  models?: Record<string, { provider: string; default: string }>
  /** What `hermes config set --help` prints. */
  configSetHelp?: string
  /** Providers that start with a credential (shown by `hermes status`). */
  credentials?: string[]
}

export const CONFIG_SET_HELP_WITH_STDIN = 'usage: hermes config set [--stdin] KEY [VALUE]\n  --stdin   read the value from standard input\n'
export const CONFIG_SET_HELP_PLAIN = 'usage: hermes config set KEY VALUE\n'

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

function reply(stream: ServerChannel, out: string, code = 0, err = ''): void {
  if (out) stream.write(out)
  if (err) stream.stderr.write(err)
  stream.exit(code)
  stream.end()
}

/** Reads what the client sends on stdin until it closes it. */
function readStdin(stream: ServerChannel): Promise<string> {
  return new Promise((done) => {
    let buf = ''
    stream.on('data', (d: Buffer) => (buf += d.toString('utf8')))
    stream.on('end', () => done(buf))
    stream.on('close', () => done(buf))
  })
}

function statusText(profile: string, o: FakeHermesOptions): string {
  const env = o.st.env.get(profile) ?? {}
  const cfg = o.st.config.get(profile) ?? {}
  const has = new Set((o.credentials ?? ['openrouter']).map((c) => c.toLowerCase()))
  if (env.OPENROUTER_API_KEY) has.add('openrouter')
  if (env.ANTHROPIC_API_KEY) has.add('anthropic')
  const lines = ['Hermes Agent status', '', 'Providers:']
  for (const slug of ['openrouter', 'anthropic']) lines.push(`  ${slug}: ${has.has(slug) ? '✓ configured' : 'not configured'}`)
  lines.push('  nous: not logged in')
  for (const k of Object.keys(cfg)) {
    const m = /^providers\.([^.]+)\.key_env$/.exec(k)
    if (m && env[cfg[k]!]) lines.push(`  ${m[1]}: ✓ configured`)
  }
  return lines.join('\n') + '\n'
}

function modelOf(profile: string, o: FakeHermesOptions): Record<string, string> {
  const base: Record<string, string> = { ...(o.models?.[profile] ?? { provider: 'openrouter', default: 'anthropic/claude-sonnet' }) }
  const cfg = o.st.config.get(profile) ?? {}
  if (cfg['model.provider']) base.provider = cfg['model.provider']
  if (cfg['model.default']) base.default = cfg['model.default']
  if (cfg['model.base_url']) base.base_url = cfg['model.base_url']
  return base
}

/** `hermes [-p P] config get|set ...`, `status` and `gateway restart`, with state in `o.st`. Returns false for anything else. */
export function runConfigCommands(rest: string[], stream: ServerChannel, o: FakeHermesOptions): boolean {
  const profile = rest[0] === '-p' ? (rest[1] ?? 'default') : 'default'
  const tail = rest[0] === '-p' ? rest.slice(2) : rest
  if (tail[0] === 'status') {
    reply(stream, statusText(profile, o))
    return true
  }
  if (tail[0] === 'gateway' && (tail[1] === 'restart' || tail[1] === 'stop')) {
    const fail = o.st.failOn['gateway']
    if (fail) {
      reply(stream, '', 1, `${fail}\n`)
      return true
    }
    if (tail[1] === 'restart') o.st.restarts.push(profile)
    else o.st.stops.push(profile)
    reply(stream, `Gateway for ${profile} ${tail[1] === 'restart' ? 'restarted' : 'stopped'}\n`)
    return true
  }
  if (tail[0] === 'approvals' && tail[1] === 'suggest') {
    const fail = o.st.failOn['approvals']
    if (fail) reply(stream, '', 1, `${fail}\n`)
    else reply(stream, 'terminal: git status (approved 14 times)\nterminal: ls -la (approved 9 times)\n')
    return true
  }
  if (tail[0] === 'sessions' && ['pin', 'unpin', 'rename'].includes(tail[1] ?? '')) {
    o.st.sessionCalls.push(rest)
    const fail = o.st.failOn['sessions']
    if (fail) reply(stream, '', 1, `${fail}\n`)
    else reply(stream, `OK ${tail[1]}\n`)
    return true
  }
  if (tail[0] !== 'config') return false
  if (tail[1] === 'set' && tail[2] === '--help') {
    reply(stream, o.configSetHelp ?? CONFIG_SET_HELP_WITH_STDIN)
    return true
  }
  if (tail[1] === 'get') {
    const key = tail[2] ?? ''
    if (key === 'model') reply(stream, JSON.stringify(modelOf(profile, o)) + '\n')
    else if (key === 'approvals') reply(stream, JSON.stringify({ mode: 'manual', cron_mode: 'deny', single_query_mode: 'manual', unattended_mode: 'deny', timeout: 60, deny: ['rm -rf /'], command_allowlist: [] }) + '\n')
    else if (key === 'agent.reasoning_effort') reply(stream, JSON.stringify(o.st.config.get(profile)?.['agent.reasoning_effort'] ?? null) + '\n')
    else reply(stream, '{}\n')
    return true
  }
  if (tail[1] === 'set') {
    const viaStdin = tail[2] === '--stdin'
    const key = (viaStdin ? tail[3] : tail[2]) ?? ''
    const done = (value: string): void => {
      const fail = o.st.failOn[key]
      if (fail) return reply(stream, '', 1, `${fail}\n`)
      if (ENV_NAME.test(key)) {
        o.st.env.set(profile, { ...(o.st.env.get(profile) ?? {}), [key]: value })
        o.st.keyVia.push(viaStdin ? 'stdin' : 'argument')
      } else {
        o.st.config.set(profile, { ...(o.st.config.get(profile) ?? {}), [key]: value })
      }
      reply(stream, `Set ${key}\n`)
    }
    if (viaStdin) void readStdin(stream).then((t) => done(t.replace(/\r?\n$/, '')))
    else done(tail[3] ?? '')
    return true
  }
  return false
}

/** The model-list script of the app runs for real, so its HTTP code is tested against a local server. */
export function runFetchScript(rest: string[], stream: ServerChannel): void {
  const child = spawn(pythonExe, ['-c', ...rest.slice(1)], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.on('error', () => {})
  stream.pipe(child.stdin)
  child.stdout.pipe(stream, { end: false })
  child.stderr.on('data', (d: Buffer) => stream.stderr.write(d))
  child.on('close', (code) => {
    stream.exit(code ?? 0)
    stream.end()
  })
  stream.on('close', () => child.kill())
}
