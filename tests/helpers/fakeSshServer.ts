import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Server, utils, type Connection, type ServerChannel } from 'ssh2'
import { pythonExe, type FixtureDirs } from './fixture'
import { attachSftp, type SftpOp } from './fakeSftp'
import { newHermesState, runConfigCommands, runFetchScript, type FakeHermesState } from './fakeHermes'
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
  /** `hermes acp` is installed (`--check` passes and a fake ACP agent answers). Off by default. */
  acp?: boolean
  /** What `hermes config set --help` prints. The default offers `--stdin`; pass a text without it to make the key travel as an argument. */
  configSetHelp?: string
  /** Providers that start with a credential (shown by `hermes status`). Default: openrouter. */
  credentials?: string[]
}

export interface FakeSsh {
  port: number
  fingerprint: string
  hostKey: HostKeyPair
  execLog: string[][]
  /** Every SFTP operation the client made (mkdir, open with its mode, remove). */
  sftpLog: SftpOp[]
  /** The state of the fake `hermes config` / `status` / `gateway` commands. */
  hermes: FakeHermesState
  dropConnections(): void
  close(): Promise<void>
}

type Resolved = Required<Omit<FakeSshOptions, 'port' | 'hostKey' | 'capabilities' | 'models' | 'chatHelp' | 'backend' | 'acp' | 'configSetHelp' | 'credentials'>> &
  Pick<FakeSshOptions, 'capabilities' | 'models' | 'chatHelp' | 'backend' | 'acp' | 'configSetHelp' | 'credentials'> & { st: FakeHermesState }

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

const REMOTE_HOME_DIR = '/home/hermes'

/** The local folder that stands for the remote home of the SSH user. */
export const localHomeDir = (o: { fixture: FixtureDirs }): string => join(o.fixture.root, 'home')

const toLocalPath = (o: { fixture: FixtureDirs }, remote: string): string =>
  remote === REMOTE_HOME_DIR ? localHomeDir(o) : remote.startsWith(REMOTE_HOME_DIR + '/') ? join(localHomeDir(o), ...remote.slice(REMOTE_HOME_DIR.length + 1).split('/')) : remote

/** Arguments that name remote paths (also inside the JSON of a query) are turned into local ones. */
function mapArg(a: string, o: Resolved): string {
  if (a === o.remoteHome) return o.fixture.home
  if (a.startsWith('{')) {
    try {
      const walk = (v: unknown): unknown => (typeof v === 'string' ? toLocalPath(o, v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v)
      return JSON.stringify(walk(JSON.parse(a)))
    } catch {
      return a
    }
  }
  return a
}

/** Local paths in a query answer are shown as the remote paths they stand for. */
function mapBack(text: string, o: Resolved): string {
  const local = localHomeDir(o)
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.startsWith(local) ? REMOTE_HOME_DIR + v.slice(local.length).split('\\').join('/') : v
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  try {
    return JSON.stringify(walk(JSON.parse(text)))
  } catch {
    return text
  }
}

function runCollector(argv: string[], stream: ServerChannel, o: Resolved): void {
  const isQuery = argv.includes('uploads_list') // only the uploads list speaks in remote paths
  const args = ['-u', '-', ...argv.slice(3).map((a) => mapArg(a, o)), '--agents-interval', '0.5']
  const child = spawn(pythonExe, args, {
    env: { ...process.env, MC_PROC_ROOT: o.fixture.proc, MC_SYS_ROOT: o.fixture.sysfs },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stdin.on('error', () => {})
  stream.pipe(child.stdin)
  // a query answers with one line; its local paths are shown as the remote ones they stand for
  if (isQuery) {
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.on('close', (code) => {
      stream.write(out.split('\n').map((l) => (l.trim() ? mapBack(l, o) : l)).join('\n'))
      stream.exit(code ?? 0)
      stream.end()
    })
  } else {
    child.stdout.pipe(stream, { end: false })
    child.on('close', (code) => {
      stream.exit(code ?? 0)
      stream.end()
    })
  }
  child.stderr.on('data', (d: Buffer) => stream.stderr.write(d))
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

/** `hermes acp`: a JSON-RPC peer that stays open until the client closes the channel. */
function runAcp(argv: string[], stream: ServerChannel, o: Resolved): void {
  const child = spawn(pythonExe, [resolve('tests/fixtures/fake_hermes_acp.py'), ...argv.slice(1)], {
    env: { ...process.env, MC_FAKE_HOME: o.fixture.home },
    stdio: ['pipe', 'pipe', 'pipe']
  })
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

/** `hermes [-p P] cron ...`: recorded, then done for real on the fixture by fake_hermes_cron.py. */
function runCron(argv: string[], stream: ServerChannel, o: Resolved): void {
  o.st.cronCalls.push(argv.slice(1))
  const fail = o.st.failOn['cron']
  if (fail) return reply(stream, '', 1, `${fail}\n`)
  const child = spawn(pythonExe, [resolve('tests/fixtures/fake_hermes_cron.py'), ...argv.slice(1)], {
    env: { ...process.env, MC_FAKE_HOME: o.fixture.home, PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
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
    if (script === 'printf %s "$HOME"') return reply(stream, REMOTE_HOME_DIR)
    if (script.includes('HERMES_HOME')) return reply(stream, o.remoteHome)
    if (script.includes('command -v hermes')) return o.hasHermes ? reply(stream, o.hermesPath) : reply(stream, '', 1)
    if (script.includes('profiles')) return reply(stream, String(countProfiles(o.fixture.home)))
  }
  if (cmd === 'test' && rest[0] === '-d') return reply(stream, '', o.hasHome && rest[1] === o.remoteHome ? 0 : 1)
  if (cmd === 'head') return reply(stream, `#!${o.pythonPath}\n`)
  if (cmd === o.hermesPath) {
    if (rest.includes('acp')) {
      if (rest.includes('--check')) return o.acp ? reply(stream, 'Hermes ACP check OK\n') : reply(stream, '', 1, 'ModuleNotFoundError: No module named acp\n')
      return o.acp ? runAcp(argv, stream, o) : reply(stream, '', 1, 'ACP is not installed\n')
    }
    if (rest.includes('chat')) return rest.includes('--help') ? reply(stream, o.chatHelp ?? FULL_CHAT_HELP) : runChat(argv, stream, o)
    if (rest.includes('terminal.backend')) return reply(stream, `${o.backend ?? 'local'}\n`)
    if (rest[0] === '--version') return reply(stream, `Hermes Agent v${o.version}\n`)
    if (rest.includes('config') && rest.includes('set') && rest[rest.length - 1] === '--help') return void runConfigCommands(rest, stream, o)
    if (rest[rest.length - 1] === '--help') {
      const key = rest.slice(0, -1).join(' ')
      return o.capabilities?.[key] === false ? reply(stream, '', 2, 'unknown command\n') : reply(stream, 'usage\n')
    }
    if ((rest[0] === 'cron' || rest[2] === 'cron') && rest[rest.length - 1] !== '--help') return runCron(argv, stream, o)
    if (runConfigCommands(rest, stream, o)) return
  }
  if (cmd === o.pythonPath || cmd === 'python3') {
    if (rest[0] === '--version') return reply(stream, 'Python 3.11.9\n')
    if (rest[0] === '-c' && (rest[1] ?? '').includes('urlopen')) return runFetchScript(rest, stream)
    if (rest[0] === '-c') return reply(stream, 'ok 31\n')
    if (rest[0] === '-u' && rest[1] === '-') return runCollector(argv, stream, o)
  }
  reply(stream, '', 127, `${cmd}: command not found\n`)
}

export function startFakeSsh(opts: FakeSshOptions): Promise<FakeSsh> {
  const st = newHermesState()
  const o: Resolved = {
    st,
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
  const sftpLog: SftpOp[] = []

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
        sess.on('sftp', (acceptSftp) => attachSftp(acceptSftp(), (remote) => toLocalPath(o, remote), sftpLog))
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
        sftpLog,
        hermes: st,
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
