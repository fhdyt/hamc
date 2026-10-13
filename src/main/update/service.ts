import { IPC } from '@shared/channels'
import { UPDATE_EVERY_MS, UPDATE_FIRST_DELAY_MS, updateErrorText, type UpdateState } from '@shared/update'

/** The part of electron-updater's `autoUpdater` the service uses (tests pass a fake). */
export interface Updater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update' | 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error', cb: (arg: never) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateDeps {
  /** Null when updates cannot work here; then `unsupportedWhy` says why. */
  updater: Updater | null
  unsupportedWhy?: string
  current: string
  enabled: () => boolean
  send: (channel: string, payload: unknown) => void
  log?: (msg: string) => void
  now?: () => number
  firstDelayMs?: number
  everyMs?: number
}

/**
 * F-APP-6: looks for a new version in the GitHub releases, downloads it in the background and installs it when the
 * app quits (or at once with Restart to update). Automatic checks follow `app.autoUpdate`; a check from the button
 * always runs. Nothing here touches the VPS.
 */
export class UpdateService {
  private state: UpdateState
  private timer: NodeJS.Timeout | null = null
  private first: NodeJS.Timeout | null = null
  private manual = false

  constructor(private readonly d: UpdateDeps) {
    this.state = { phase: d.updater ? 'idle' : 'unsupported', current: d.current, version: null, percent: null, checkedAt: null, message: d.updater ? null : (d.unsupportedWhy ?? 'Updates work in the installed app only.') }
    const u = d.updater
    if (!u) return
    u.autoDownload = true
    u.autoInstallOnAppQuit = true
    u.on('checking-for-update', () => this.set({ phase: 'checking', message: null }))
    u.on('update-available', (info: { version?: string }) => {
      this.d.log?.(`update: ${info.version ?? '?'} available, downloading`)
      this.set({ phase: 'downloading', version: info.version ?? null, percent: 0 })
    })
    u.on('update-not-available', () => this.set({ phase: 'none', percent: null, checkedAt: this.now(), message: null }))
    u.on('download-progress', (p: { percent?: number }) => this.set({ phase: 'downloading', percent: Math.round(p.percent ?? 0) }))
    u.on('update-downloaded', (info: { version?: string }) => {
      this.d.log?.(`update: ${info.version ?? '?'} downloaded, installs on quit`)
      this.set({ phase: 'ready', version: info.version ?? this.state.version, percent: 100, checkedAt: this.now() })
    })
    u.on('error', (e: unknown) => {
      const message = updateErrorText(e)
      this.d.log?.(`update: error ${message}`)
      // a failed automatic check stays quiet (no network, no release yet); one the user asked for says why
      this.set(this.manual || this.state.phase === 'downloading' ? { phase: 'error', message, checkedAt: this.now() } : { phase: this.state.phase === 'ready' ? 'ready' : 'idle', checkedAt: this.now() })
    })
  }

  private now(): number {
    return this.d.now?.() ?? Date.now()
  }

  private set(p: Partial<UpdateState>): void {
    this.state = { ...this.state, ...p }
    this.d.send(IPC.evUpdate, this.state)
  }

  get(): UpdateState {
    return this.state
  }

  /** Starts the automatic checks (first after a short delay, then every 6 hours). */
  start(): void {
    if (!this.d.updater) return
    this.stop()
    this.first = setTimeout(() => void this.auto(), this.d.firstDelayMs ?? UPDATE_FIRST_DELAY_MS)
    this.first.unref()
    this.timer = setInterval(() => void this.auto(), this.d.everyMs ?? UPDATE_EVERY_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = null
    this.timer = null
  }

  private async auto(): Promise<void> {
    if (!this.d.enabled() || this.busy()) return
    this.manual = false
    await this.run()
  }

  private busy(): boolean {
    return this.state.phase === 'checking' || this.state.phase === 'downloading' || this.state.phase === 'ready'
  }

  /** The Check for updates button. */
  async check(): Promise<UpdateState> {
    if (!this.d.updater || this.busy()) return this.state
    this.manual = true
    await this.run()
    return this.state
  }

  private async run(): Promise<void> {
    try {
      await this.d.updater!.checkForUpdates()
    } catch (e) {
      // the 'error' event normally reports it; this covers an updater that only rejects
      if (this.state.phase === 'checking') this.set(this.manual ? { phase: 'error', message: updateErrorText(e), checkedAt: this.now() } : { phase: 'idle', checkedAt: this.now() })
    }
  }

  /** Restart to update: only once the new version is downloaded. */
  install(): boolean {
    if (!this.d.updater || this.state.phase !== 'ready') return false
    this.d.log?.(`update: restarting into ${this.state.version ?? '?'}`)
    this.d.updater.quitAndInstall(false, true)
    return true
  }
}
