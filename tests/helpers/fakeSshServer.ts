import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Server, utils, type Connection, type ServerChannel } from 'ssh2'
import { pythonExe, type FixtureDirs } from './fixture'
import { shSplit } from './shellSplit'

export interface HostKeyPair {
  private: string
  public: string
}

export function makeHostKey(): HostKeyPair {
  // ssh2 now and then emits an OpenSSH key that it cannot parse back, so keep only keys that round-trip.
  for (let attempt = 0; attempt < 20; attempt++) {
    const kp = utils.generateKeyPairSync('ed25519')
    const back = utils.parseKey(kp.private)
    if (!(back instanceof Error) && !(Array.isArray(back) && back[0] instanceof Error)) return { private: kp.private, public: kp.public }
  }
  throw new Error('cannot generate a usable host key')
}

export function fingerprintOfPublic(pub: string): string {
  const parsed = utils.parseKey(pub)
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (!key || key instanceof Error) throw new Error('cannot parse host key')
  const blob = key.getPublicSSH()
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

export interface FakeSshOptions {
  fixture: FixtureDirs
  username?: string
  password?: string
  port?: number
  hostKey?: HostKeyPair
  remoteHome?: string
  hermesPath?: string
  pythonPath?: string
  version?: string
  capabilities?: Record<string, boolean>
  models?: Record<string, { provider: string; default: string }>
  hasHermes?: boolean
  hasHome?: boolean
  /** What `hermes chat --help` prints (the default lists every option the chat needs). */
  chatHelp?: string
  /** What `hermes config get terminal.backend` prints. */
  backend?: string
}

export interface FakeSsh {
  port: number
  fingerprint: string
  hostKey: HostKeyPair
  execLog: string[][]
  dropConnections(): void
  close(): Promise<void>
}

type Resolved = Required<Omit<FakeSshOptions, 'port' | 'hostKey' | 'capabilities' | 'models' | 'chatHelp' | 'backend'>> &
  Pick<FakeSshOptions, 'capabilities' | 'models' | 'chatHelp' | 'backend'>

const MARKERS = ['config.yaml', '.env', 'SOUL.md', 'profile.yaml', 'state.db']

function reply(stream: ServerChannel, out: string, code = 0, err = ''): void {
  if (out) stream.write(out)
  if (err) stream.stderr.write(err)
  stream.exit(code)
  stream.end()
}

function countProfiles(home: string): number {
  try {
    const base = join(home, 'profiles')
    return readdirSync(base).filter(
      (n) => statSync(join(base, n)).isDirectory() && MARKERS.some((m) => existsSync(join(base, n, m)))
    ).length
  } catch {
    return 0
  }
}

function runCollector(argv: string[], stream: ServerChannel, o: Resolved): void {
  const args = ['-u', '-', ...argv.slice(3).map((a) => (a === o.remoteHome ? o.fixture.home : a)), '--agents-interval', '0.5']
  const child = spawn(pythonExe, args, {
    env: { ...process.env, MC_PROC_ROOT: o.fixture.proc, MC_SYS_ROOT: o.fixture.sysfs },
    stdio: ['pipe', 'pipe', 'pipe']
  })
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

export const FULL_CHAT_HELP = `usage: hermes chat [options]
  -q, --query TEXT      single query
  -Q, --quiet           only print the answer
  --oneshot             run one turn and exit
  --query-file FILE     read the message from FILE ('-' is stdin)
  --format FORMAT       output format: text, json, stream-json
  --resume SESSION_ID   continue a session
  --source TAG          tag the session source
`

const chats = new WeakMap<ServerChannel, ChildProcess>()

function runChat(argv: string[], stream: ServerChannel, o: Resolved): void {
  const child = spawn(pythonExe, [resolve('tests/fixtures/fake_hermes.py'), ...argv.slice(1)], {
    env: { ...process.env, MC_FAKE_HOME: o.fixture.home },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  chats.set(stream, child)
  child.stdin.on('error', () => {})
  stream.pipe(child.stdin)
  child.stdout.pipe(stream, { end: false })
  child.stderr.on('data', (d: Buffer) => stream.stderr.write(d))
  child.on('close', (code) => {
    if (!stream.writable) return
    stream.exit(code ?? 0)
    stream.end()
  })
  stream.on('close', () => child.kill())
}

/** A signal request (Stop) ends the fake chat the way Hermes does: a result with exit code 130. */
function interruptChat(stream: ServerChannel): void {
  const child = chats.get(stream)
  if (!child) return
  chats.delete(stream)
  child.removeAllListeners('close')
  child.kill()
  stream.write(JSON.stringify({ type: 'result', exit_code: 130, duration_ms: 10 }) + '\n')
  stream.exit(130)
  stream.end()
}

function handle(argv: string[], stream: ServerChannel, o: Resolved): void {
  const [cmd = '', ...rest] = argv
  if (cmd === 'true') return reply(stream, '')
  if (cmd === '__echo__') return reply(stream, JSON.stringify(rest))
  if (cmd === 'sh' && rest[0] === '-c') {
    const script = rest[1] ?? ''
    if (script.includes('HERMES_HOME')) return reply(stream, o.remoteHome)
    if (script.includes('command -v hermes')) return o.hasHermes ? reply(stream, o.hermesPath) : reply(stream, '', 1)
    if (script.includes('profiles')) return reply(stream, String(countProfiles(o.fixture.home)))
  }
  if (cmd === 'test' && rest[0] === '-d') return reply(stream, '', o.hasHome && rest[1] === o.remoteHome ? 0 : 1)
  if (cmd === 'head' && rest[0] === '-c') {
    const remote = rest[2] ?? ''
    const root = o.remoteHome.replace(/\/+$/, '')
    if (!remote.startsWith(root + '/')) return reply(stream, '', 1, 'No such file\n')
    const local = join(o.fixture.home, ...remote.slice(root.length + 1).split('/'))
    if (!existsSync(local) || !statSync(local).isFile()) return reply(stream, '', 1, 'No such file\n')
    return reply(stream, readFileSync(local).subarray(0, Number(rest[1])).toString('utf8'))
  }
  if (cmd === 'head') return reply(stream, `#!${o.pythonPath}\n`)
  if (cmd === o.hermesPath) {
    if (rest.includes('chat')) return rest.includes('--help') ? reply(stream, o.chatHelp ?? FULL_CHAT_HELP) : runChat(argv, stream, o)
    if (rest.includes('terminal.backend')) return reply(stream, `${o.backend ?? 'local'}\n`)
    if (rest[0] === '--version') return reply(stream, `Hermes Agent v${o.version}\n`)
    if (rest[rest.length - 1] === '--help') {
      const key = rest.slice(0, -1).join(' ')
      return o.capabilities?.[key] === false ? reply(stream, '', 2, 'unknown command\n') : reply(stream, 'usage\n')
    }
    const gi = rest.indexOf('config')
    if (gi >= 0 && rest[gi + 1] === 'get' && rest[gi + 2] === 'model') {
      const profile = rest[0] === '-p' ? (rest[1] ?? 'default') : 'default'
      const m = o.models?.[profile] ?? { provider: 'openrouter', default: 'anthropic/claude-sonnet' }
      return reply(stream, JSON.stringify(m) + '\n')
    }
  }
  if (cmd === o.pythonPath || cmd === 'python3') {
    if (rest[0] === '--version') return reply(stream, 'Python 3.11.9\n')
    if (rest[0] === '-c') return reply(stream, 'ok 31\n')
    if (rest[0] === '-u' && rest[1] === '-') return runCollector(argv, stream, o)
  }
  reply(stream, '', 127, `${cmd}: command not found\n`)
}

export function startFakeSsh(opts: FakeSshOptions): Promise<FakeSsh> {
  const o: Resolved = {
    username: 'tester',
    password: 'test-pass-123',
    remoteHome: '/home/hermes/.hermes',
    hermesPath: '/home/hermes/.local/bin/hermes',
    pythonPath: '/usr/bin/python3',
    version: '0.21.6',
    hasHermes: true,
    hasHome: true,
    ...opts
  }
  const hostKey = opts.hostKey ?? makeHostKey()
  const clients = new Set<Connection>()
  const execLog: string[][] = []

  const server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    clients.add(client)
    client.on('close', () => clients.delete(client))
    client.on('error', () => {})
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === o.username && ctx.password === o.password) ctx.accept()
      else ctx.reject(['password'])
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const sess = accept()
        sess.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          const argv = shSplit(info.command)
          execLog.push(argv)
          handle(argv, stream, o)
          sess.once('signal', (acceptSignal, _rej, sig) => {
            acceptSignal?.()
            if (sig.name === 'INT') interruptChat(stream)
          })
        })
      })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        fingerprint: fingerprintOfPublic(hostKey.public),
        hostKey,
        execLog,
        dropConnections: () => clients.forEach((c) => c.end()),
        close: () =>
          new Promise<void>((done) => {
            clients.forEach((c) => c.end())
            server.close(() => done())
          })
      })
    })
  })
}
