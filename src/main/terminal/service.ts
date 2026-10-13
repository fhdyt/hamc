import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import { IPC } from '@shared/channels'
import { TERM_MAX_TABS, type TermExit, type TermOpenResult, type TermSize } from '@shared/terminal'

export interface TerminalDeps {
  conn: { isConnected(): boolean; openShell(size: TermSize): Promise<ClientChannel> }
  send: (channel: string, payload: unknown) => void
  /** Only opens and closes are logged, never what is typed or printed (F-TERM-5). */
  log?: (msg: string) => void
  /** How long output is gathered before it goes to the window. */
  flushMs?: number
  maxTabs?: number
}

interface Shell {
  stream: ClientChannel
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

  async open(size: TermSize): Promise<TermOpenResult> {
    if (!this.d.conn.isConnected()) return { ok: false, error: 'not-connected' }
    if (this.shells.size >= (this.d.maxTabs ?? TERM_MAX_TABS)) return { ok: false, error: 'too-many' }
    let stream: ClientChannel
    try {
      stream = await this.d.conn.openShell(size)
    } catch (e) {
      return { ok: false, error: 'failed', detail: e instanceof Error ? e.message : String(e) }
    }
    const id = randomUUID()
    const sh: Shell = { stream, decoder: new StringDecoder('utf8'), buf: '', timer: null, code: null, done: false }
    this.shells.set(id, sh)
    const onData = (chunk: Buffer): void => {
      sh.buf += sh.decoder.write(chunk)
      if (sh.buf.length >= FLUSH_BYTES) this.flush(id, sh)
      else if (!sh.timer) sh.timer = setTimeout(() => this.flush(id, sh), this.d.flushMs ?? 8)
    }
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
    this.d.log?.(`terminal opened (${this.shells.size} open)`)
    return { ok: true, id }
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
    sh.stream.write(data)
    return true
  }

  resize(id: string, size: TermSize): void {
    this.shells.get(id)?.stream.setWindow(size.rows, size.cols, 0, 0)
  }

  /** Closes one tab's shell; the `close` event above tells the window. */
  close(id: string): void {
    const sh = this.shells.get(id)
    if (!sh) return
    sh.stream.end()
    sh.stream.close()
  }

  /** The connection is going away (disconnect, drop or a new connection): every shell ends as `disconnected`. */
  closeAll(): void {
    if (this.shells.size === 0) return
    const all = [...this.shells.entries()]
    for (const [id, sh] of all) {
      this.finish(id, sh, 'disconnected')
      try {
        sh.stream.close()
      } catch {
        /* the channel may already be gone with the connection */
      }
    }
    this.d.log?.(`terminal: ${all.length} shell(s) ended with the connection`)
  }
}
