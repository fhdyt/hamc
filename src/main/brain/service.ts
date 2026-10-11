import type { ClientChannel } from 'ssh2'
import type { CollectorEvent } from '@shared/events'
import { CollectorChannel } from '../collector/channel'

interface Streamer {
  openStream(argv: readonly string[], stdin: string): Promise<ClientChannel>
  isConnected(): boolean
}

export interface BrainDeps {
  conn: Streamer
  script: string
  /** Called for every event of the vault stream (brain and error events). */
  onEvent: (ev: CollectorEvent) => void
  log?: (msg: string) => void
  /** How long to wait before restarting a stream that ended while connected. */
  restartMs?: number
}

interface Target {
  python: string
  home: string
}

/**
 * Owns the vault stream: a second collector process on the server that parses the vault and sends per-note records.
 * It runs only while there is a connection and a saved vault path, and restarts when the path changes.
 */
export class BrainService {
  private stream: CollectorChannel | null = null
  private timer: NodeJS.Timeout | null = null
  private target: Target | null = null
  private vault: string | null = null

  constructor(private readonly d: BrainDeps) {}

  getVault(): string | null {
    return this.vault
  }

  /** Called when a connection is established. */
  attach(target: Target, vault: string | null): void {
    this.target = target
    this.vault = vault
    this.restart()
  }

  /** Called when the connection goes away. The vault path itself is kept. */
  detach(): void {
    this.target = null
    this.halt()
  }

  setVault(vault: string | null): void {
    this.vault = vault
    this.restart()
  }

  private halt(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const s = this.stream
    this.stream = null
    s?.stop()
  }

  private restart(): void {
    this.halt()
    if (this.target && this.vault) void this.start(this.target, this.vault)
  }

  private async start(t: Target, vault: string): Promise<void> {
    const ch = new CollectorChannel(this.d.conn, { python: t.python, home: t.home, script: this.d.script, extraArgs: ['--vault', vault], log: this.d.log })
    ch.on('event', (ev: CollectorEvent) => this.d.onEvent(ev))
    ch.on('closed', () => {
      if (this.stream !== ch) return
      this.stream = null
      if (!this.d.conn.isConnected() || !this.target || this.vault !== vault) return
      this.timer = setTimeout(() => {
        if (this.d.conn.isConnected() && !this.stream && this.target && this.vault === vault) void this.start(this.target, vault)
      }, this.d.restartMs ?? 3000)
      this.timer.unref()
    })
    this.stream = ch
    try {
      await ch.start()
    } catch (e) {
      if (this.stream === ch) this.stream = null
      this.d.log?.(`vault stream failed to start: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
