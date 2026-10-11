import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Server, utils, type Connection, type ServerChannel } from 'ssh2'
import { pythonExe, type FixtureDirs } from './fixture'
import { shSplit } from './shellSplit'

export interface HostKeyPair {
  private: string
  public: string
}

export function makeHostKey(): HostKeyPair {
  const kp = utils.generateKeyPairSync('ed25519')
  return { private: kp.private, public: kp.public }
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
}

export interface FakeSsh {
  port: number
  fingerprint: string
  hostKey: HostKeyPair
  execLog: string[][]
  dropConnections(): void
  close(): Promise<void>
}

type Resolved = Required<Omit<FakeSshOptions, 'port' | 'hostKey' | 'capabilities' | 'models'>> &
  Pick<FakeSshOptions, 'capabilities' | 'models'>

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
  const args = ['-u', '-', ...argv.slice(3).map((a) => (a === o.remoteHome ? o.fixture.home : a))]
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
  if (cmd === 'head') return reply(stream, `#!${o.pythonPath}\n`)
  if (cmd === o.hermesPath) {
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
        accept().on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          const argv = shSplit(info.command)
          execLog.push(argv)
          handle(argv, stream, o)
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
