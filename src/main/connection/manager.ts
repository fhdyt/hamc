import { EventEmitter } from 'node:events'
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import type { HostKeyChallenge, KeyFormat } from '@shared/ipc'
import { ConnectError, HostKeyError, classifyConnectError, friendlyMessage } from './errors'
import { algoOf, decideHostKey, type KnownKey } from './hostkey'
import type { SshTarget } from '../terminal/localShell'
import { buildCommand } from './quote'

/** One sign-in method per connection (F-CONN-7). The key's bytes stay in the main process. */
export type ConnectAuth = { password: string } | { privateKey: Buffer; passphrase?: string; keyPath: string; keyFormat: KeyFormat }

export type ConnectParams = { host: string; port: number; username: string } & ConnectAuth

export const PPK_TERMINAL_NOTE = 'This key is in PuTTY format, which the system ssh cannot read: using the built-in shell.'

export interface HostKeyLookup {
  getKnownHost(host: string, port: number): KnownKey | null
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ExecOptions {
  stdin?: string
  timeoutMs?: number
}

export interface Execer {
  exec(argv: readonly string[], opts?: ExecOptions): Promise<ExecResult>
}

export class ConnectionManager extends EventEmitter implements Execer {
  private client: Client | null = null
  private closing = false
  /** Where the current connection goes and the host key it was checked against (for the system ssh of a server tab). */
  private target: { host: string; port: number; username: string; key: Buffer; keyPath: string | null; keyFormat: KeyFormat | null } | null = null

  constructor(
    private readonly hostKeys: HostKeyLookup,
    private readonly readyTimeoutMs = 12_000
  ) {
    super()
  }

  isConnected(): boolean {
    return this.client !== null
  }

  /** The server of the last successful connection with the host key the user trusted, for the system ssh. */
  sshTarget(): SshTarget | null {
    const t = this.target
    if (!t) return null
    const base = { host: t.host, port: t.port, username: t.username, algo: algoOf(t.key), key: t.key.toString('base64') }
    if (!t.keyPath) return base
    return t.keyFormat === 'ppk' ? { ...base, systemSshProblem: PPK_TERMINAL_NOTE } : { ...base, identity: t.keyPath }
  }

  async connect(p: ConnectParams): Promise<{ fingerprint: string; algo: string }> {
    await this.disconnect()
    return new Promise((resolve, reject) => {
      const client = new Client()
      let challenge: HostKeyChallenge | null = null
      let seen = { fingerprint: '', algo: '' }
      let seenKey: Buffer | null = null
      let settled = false

      client.on('ready', () => {
        settled = true
        this.closing = false
        this.client = client
        this.target = seenKey
          ? { host: p.host, port: p.port, username: p.username, key: seenKey, keyPath: 'keyPath' in p ? p.keyPath : null, keyFormat: 'keyFormat' in p ? p.keyFormat : null }
          : null
        resolve(seen)
      })
      client.on('error', (err: Error & { code?: string; level?: string }) => {
        if (settled) {
          this.emit('error-log', err)
          return
        }
        settled = true
        if (challenge) return reject(new HostKeyError(challenge))
        const kind = classifyConnectError(err)
        reject(new ConnectError(kind, friendlyMessage(kind, p.host, p.port, err.message, { key: 'privateKey' in p, username: p.username })))
      })
      client.on('close', () => {
        if (this.client === client) {
          this.client = null
          if (!this.closing) this.emit('close')
        }
        if (!settled) {
          settled = true
          if (challenge) return reject(new HostKeyError(challenge))
          reject(new ConnectError('unreachable', friendlyMessage('unreachable', p.host, p.port, 'closed')))
        }
      })

      client.connect({
        host: p.host,
        port: p.port,
        username: p.username,
        ...('password' in p ? { password: p.password } : { privateKey: p.privateKey, ...(p.passphrase ? { passphrase: p.passphrase } : {}) }),
        readyTimeout: this.readyTimeoutMs,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: ((key: Buffer): boolean => {
          const d = decideHostKey(this.hostKeys.getKnownHost(p.host, p.port), key)
          seen = { fingerprint: d.fingerprint, algo: d.algo }
          if (d.kind === 'trusted') {
            seenKey = Buffer.from(key)
            return true
          }
          challenge = {
            host: p.host,
            port: p.port,
            algo: d.algo,
            fingerprint: d.fingerprint,
            changed: d.kind === 'changed',
            ...(d.kind === 'changed' ? { previous: d.previous } : {})
          }
          return false
        }) as never
      })
    })
  }

  async disconnect(): Promise<void> {
    // a dropped connection keeps the target (system ssh tabs do not depend on this connection); leaving does not
    this.target = null
    const c = this.client
    if (!c) return
    this.closing = true
    this.client = null
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 500)
      c.once('close', () => {
        clearTimeout(t)
        resolve()
      })
      c.end()
    })
  }

  exec(argv: readonly string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const { stdin = '', timeoutMs = 15_000 } = opts
    return new Promise((resolve, reject) => {
      const c = this.client
      if (!c) return reject(new Error('not connected'))
      c.exec(buildCommand(argv), (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => {
          stream.close()
          reject(new Error(`timed out after ${timeoutMs} ms`))
        }, timeoutMs)
        stream.setEncoding('utf8')
        stream.stderr.setEncoding('utf8')
        stream.on('data', (d: string) => (stdout += d))
        stream.stderr.on('data', (d: string) => (stderr += d))
        stream.on('close', (code: number | null) => {
          clearTimeout(timer)
          resolve({ code: code ?? -1, stdout, stderr })
        })
        stream.end(stdin)
      })
    })
  }

  openStream(argv: readonly string[], stdin: string): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const c = this.client
      if (!c) return reject(new Error('not connected'))
      c.exec(buildCommand(argv), (err, stream) => {
        if (err) return reject(err)
        stream.end(stdin)
        resolve(stream)
      })
    })
  }

  /** Starts a command and keeps its stdin open (ACP mode talks to `hermes acp` over it). */
  openDuplex(argv: readonly string[]): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const c = this.client
      if (!c) return reject(new Error('not connected'))
      c.exec(buildCommand(argv), (err, stream) => (err ? reject(err) : resolve(stream)))
    })
  }

  /** An interactive login shell with a PTY (the Terminal panel, F-TERM-1). Nothing is typed into it here. */
  openShell(size: { cols: number; rows: number }): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const c = this.client
      if (!c) return reject(new Error('not connected'))
      c.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (err, stream) => (err ? reject(err) : resolve(stream)))
    })
  }

  /** An SFTP session on the current connection. The caller ends it. Only used for uploads the user asked for. */
  sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      const c = this.client
      if (!c) return reject(new Error('not connected'))
      c.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
    })
  }

  async measureLatency(): Promise<number> {
    const t = performance.now()
    await this.exec(['true'], { timeoutMs: 5000 })
    return Math.round(performance.now() - t)
  }
}
