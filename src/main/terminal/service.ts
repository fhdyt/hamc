import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import { IPC } from '@shared/channels'
import { TERM_MAX_TABS, type TermExit, type TermInfo, type TermOpenRequest, type TermOpenResult, type TermServerVia, type TermSize } from '@shared/terminal'
import { knownHostsLine, pickLocalShell, findSsh, sshArgs, terminalEnv, type SshTarget } from './localShell'
import type { PtyLike, SpawnPty } from './pty'

export interface TerminalDeps {
  conn: { isConnected(): boolean; openShell(size: TermSize): Promise<ClientChannel>; sshTarget(): SshTarget | null }
  send: (channel: string, payload: unknown) => void
  /** Only opens and closes are logged, never what is typed or printed (F-TERM-5). */
  log?: (msg: string) => void
  /** How long output is gathered before it goes to the window. */
  flushMs?: number
  maxTabs?: number
  /** Local terminals: the pseudo-terminal factory and what it needs to know about this computer. */
  local?: {
    spawn: SpawnPty
    platform: NodeJS.Platform
    env: Record<string, string | undefined>
    home: string
    exists: (file: string) => boolean
    /** Writes the known_hosts file the system ssh checks the server against; answers its path. */
    writeKnownHosts: (text: string) => string
    /** Why the native module cannot load, if it cannot. */
    problem: () => string | null
  }
  /** Settings → Terminal: how server tabs reach the server. */
  serverVia?: () => TermServerVia
}

interface Backend {
  write(data: string): void
  resize(size: TermSize): void
  close(): void
}

interface Shell {
  backend: Backend
  /** Built-in shells ride on the app's connection and end with it; the others are processes of this computer. */
  builtin: boolean
  decoder: StringDecoder
  buf: string
  timer: NodeJS.Timeout | null
  code: number | null
  /** The window was already told the shell ended. */
  done: boolean
}

/** Batches above this size go out at once instead of waiting for the timer. */
const FLUSH_BYTES = 64 * 1024

/** Interactive shells of the Terminal panel. Nothing here writes into a shell except `write`, which only the user's keys reach. */
export class TerminalService {
  private readonly shells = new Map<string, Shell>()

  constructor(private readonly d: TerminalDeps) {}

  count(): number {
    return this.shells.size
  }

  /** The shell and ssh a tab would start on this computer. */
  info(): TermInfo {
    const l = this.d.local
    if (!l) return { localShell: null, ssh: null, problem: 'not available in this build' }
    const problem = l.problem()
    return { localShell: problem ? null : pickLocalShell(l.platform, l.env, l.exists).file, ssh: findSsh(l.platform, l.env, l.exists), problem }
  }

  async open(req: TermOpenRequest): Promise<TermOpenResult> {
    if (this.shells.size >= (this.d.maxTabs ?? TERM_MAX_TABS)) return { ok: false, error: 'too-many' }
    const size = { cols: req.cols, rows: req.rows }
    if (req.kind === 'local') return this.openLocal(size)
    const l = this.d.local
    const ssh = l && (req.via ?? this.d.serverVia?.() ?? 'system') === 'system' && !l.problem() ? findSsh(l.platform, l.env, l.exists) : null
    const target = this.d.conn.sshTarget()
    if (ssh && target) return this.openSystemSsh(size, ssh, target)
    return this.openBuiltin(size)
  }

  private openLocal(size: TermSize): TermOpenResult {
    const l = this.d.local
    if (!l) return { ok: false, error: 'unavailable', detail: 'not available in this build' }
    const prog = pickLocalShell(l.platform, l.env, l.exists)
    return this.spawn(size, prog.file, prog.args, prog.label, 'local')
  }

  private openSystemSsh(size: TermSize, ssh: string, t: SshTarget): TermOpenResult {
    const l = this.d.local!
    let file: string
    try {
      file = l.writeKnownHosts(knownHostsLine(t))
    } catch (e) {
      return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) }
    }
    return this.spawn(size, ssh, sshArgs(t, file), 'ssh', 'system-ssh')
  }

  private spawn(size: TermSize, file: string, args: string[], label: string, via: 'local' | 'system-ssh'): TermOpenResult {
    const l = this.d.local!
    let pty: PtyLike
    try {
      pty = l.spawn(file, args, { size, cwd: l.home, env: terminalEnv(l.env) })
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      return { ok: false, error: /not available/.test(detail) ? 'unavailable' : 'failed', detail }
    }
    const id = randomUUID()
    const sh = this.add(id, {
      write: (d) => pty.write(d),
      resize: (s) => pty.resize(s.cols, s.rows),
      close: () => pty.kill()
    }, false)
    pty.onData((data) => this.push(id, sh, data))
    pty.onExit(({ exitCode }) => {
      sh.code = exitCode
      if (sh.done) return
      this.finish(id, sh, 'exited')
      this.d.log?.(`terminal closed (${this.shells.size} open)`)
    })
    this.d.log?.(`terminal opened: ${via} (${this.shells.size} open)`)
    return { ok: true, id, via, label }
  }

  private async openBuiltin(size: TermSize): Promise<TermOpenResult> {
    if (!this.d.conn.isConnected()) return { ok: false, error: 'not-connected' }
    let stream: ClientChannel
    try {
      stream = await this.d.conn.openShell(size)
    } catch (e) {
      return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) }
    }
    const id = randomUUID()
    const sh = this.add(id, {
      write: (d) => stream.write(d),
      resize: (s) => stream.setWindow(s.rows, s.cols, 0, 0),
      close: () => {
        stream.end()
        stream.close()
      }
    }, true)
    const onData = (chunk: Buffer): void => this.push(id, sh, sh.decoder.write(chunk))
    stream.on('data', onData)
    stream.stderr.on('data', onData)
    stream.on('exit', (code: number | null) => {
      sh.code = typeof code === 'number' ? code : null
    })
    stream.on('close', () => {
      if (sh.done) return
      this.finish(id, sh, 'exited')
      this.d.log?.(`terminal closed (${this.shells.size} open)`)
    })
    this.d.log?.(`terminal opened: builtin (${this.shells.size} open)`)
    return { ok: true, id, via: 'builtin', label: 'ssh' }
  }

  private add(id: string, backend: Backend, builtin: boolean): Shell {
    const sh: Shell = { backend, builtin, decoder: new StringDecoder('utf8'), buf: '', timer: null, code: null, done: false }
    this.shells.set(id, sh)
    return sh
  }

  private push(id: string, sh: Shell, text: string): void {
    sh.buf += text
    if (sh.buf.length >= FLUSH_BYTES) this.flush(id, sh)
    else if (!sh.timer) sh.timer = setTimeout(() => this.flush(id, sh), this.d.flushMs ?? 8)
  }

  private finish(id: string, sh: Shell, reason: TermExit['reason']): void {
    sh.done = true
    sh.buf += sh.decoder.end()
    this.flush(id, sh)
    this.shells.delete(id)
    this.d.send(IPC.evTermExit, { id, reason, code: reason === 'exited' ? sh.code : null } satisfies TermExit)
  }

  private flush(id: string, sh: Shell): void {
    if (sh.timer) clearTimeout(sh.timer)
    sh.timer = null
    if (!sh.buf) return
    const data = sh.buf
    sh.buf = ''
    this.d.send(IPC.evTermData, { id, data })
  }

  /** Keys and pastes of the user. False when that shell is gone. */
  write(id: string, data: string): boolean {
    const sh = this.shells.get(id)
    if (!sh) return false
    sh.backend.write(data)
    return true
  }

  resize(id: string, size: TermSize): void {
    try {
      this.shells.get(id)?.backend.resize(size)
    } catch {
      /* the process ended in the meantime */
    }
  }

  /** Closes one tab's shell; its end event tells the window. */
  close(id: string): void {
    const sh = this.shells.get(id)
    if (!sh) return
    try {
      sh.backend.close()
    } catch {
      /* already gone */
    }
  }

  /** The app's connection is going away: built-in server shells end as `disconnected`; local terminals stay. */
  closeAll(): void {
    const all = [...this.shells.entries()].filter(([, sh]) => sh.builtin)
    if (all.length === 0) return
    for (const [id, sh] of all) {
      this.finish(id, sh, 'disconnected')
      try {
        sh.backend.close()
      } catch {
        /* the channel may already be gone with the connection */
      }
    }
    this.d.log?.(`terminal: ${all.length} shell(s) ended with the connection`)
  }

  /** The app quits: every shell of this computer ends with it. */
  killAll(): void {
    for (const sh of this.shells.values()) {
      sh.done = true
      try {
        sh.backend.close()
      } catch {
        /* already gone */
      }
    }
    this.shells.clear()
  }
}
