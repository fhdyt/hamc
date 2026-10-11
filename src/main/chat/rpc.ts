import type { ClientChannel } from 'ssh2'
import { LineSplitter } from '../collector/lines'

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
  }
}

export interface RpcHandlers {
  notification(method: string, params: unknown): void
  /** A request from the other side. Throw an `RpcError` for a method that is not offered. */
  request(method: string, params: unknown): Promise<unknown>
  closed(): void
}

interface Waiting {
  resolve(v: unknown): void
  reject(e: Error): void
  timer: NodeJS.Timeout | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** JSON-RPC 2.0 over one SSH channel, one JSON message per line (the framing of ACP over stdio). */
export class JsonRpc {
  private nextId = 1
  private waiting = new Map<number, Waiting>()
  private lines = new LineSplitter(8 * 1024 * 1024)
  private stderr = ''
  private done = false

  constructor(
    private readonly ch: ClientChannel,
    private readonly h: RpcHandlers
  ) {
    ch.setEncoding('utf8')
    ch.stderr.setEncoding('utf8')
    ch.on('data', (chunk: string) => {
      for (const line of this.lines.push(chunk)) this.onLine(line)
    })
    ch.stderr.on('data', (d: string) => {
      this.stderr = (this.stderr + d).slice(-2000)
    })
    ch.on('close', () => {
      this.done = true
      for (const w of this.waiting.values()) {
        if (w.timer) clearTimeout(w.timer)
        w.reject(new Error(this.stderrTail() || 'The connection to Hermes ended.'))
      }
      this.waiting.clear()
      this.h.closed()
    })
  }

  get isClosed(): boolean {
    return this.done
  }

  stderrTail(): string {
    return this.stderr.trim().split('\n').filter(Boolean).slice(-3).join(' ').slice(0, 400)
  }

  /** `timeoutMs` 0 waits for as long as it takes (a prompt may run for many minutes). */
  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.done) return reject(new Error('The connection to Hermes ended.'))
      const id = this.nextId++
      const w: Waiting = { resolve, reject, timer: null }
      if (timeoutMs > 0) {
        w.timer = setTimeout(() => {
          this.waiting.delete(id)
          reject(new Error(`Hermes did not answer ${method} in time.`))
        }, timeoutMs)
      }
      this.waiting.set(id, w)
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  close(): void {
    try {
      this.ch.close()
    } catch {
      /* already closed */
    }
  }

  private write(msg: unknown): void {
    if (this.done) return
    try {
      this.ch.write(`${JSON.stringify(msg)}\n`)
    } catch {
      /* the channel is going away; close handling rejects what is waiting */
    }
  }

  private onLine(line: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return // log lines or noise on stdout
    }
    if (!isObj(msg)) return
    const method = typeof msg['method'] === 'string' ? msg['method'] : null
    const id = msg['id']
    if (method !== null) {
      if (typeof id === 'number' || typeof id === 'string') {
        this.h.request(method, msg['params']).then(
          (result) => this.write({ jsonrpc: '2.0', id, result: result ?? null }),
          (e: unknown) => this.write({ jsonrpc: '2.0', id, error: { code: e instanceof RpcError ? e.code : -32603, message: e instanceof Error ? e.message : 'error' } })
        )
      } else this.h.notification(method, msg['params'])
      return
    }
    if (typeof id !== 'number') return
    const w = this.waiting.get(id)
    if (!w) return
    this.waiting.delete(id)
    if (w.timer) clearTimeout(w.timer)
    const err = msg['error']
    if (isObj(err)) w.reject(new Error(typeof err['message'] === 'string' ? err['message'] : 'Hermes reported an error.'))
    else w.resolve(msg['result'])
  }
}
