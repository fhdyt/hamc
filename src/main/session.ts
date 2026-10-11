import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import type {
  ConnStatus, ConnectErrorKind, ConnectRequest, ConnectResult, HostKeyChallenge, SavedConnection
} from '@shared/ipc'
import { CollectorChannel } from './collector/channel'
import { ModelResolver } from './collector/models'
import { backoffDelay } from './connection/backoff'
import { probeCapabilities } from './connection/capabilities'
import { ConnectError, HostKeyError } from './connection/errors'
import type { ConnectParams, ConnectionManager } from './connection/manager'
import { runPreflight } from './connection/preflight'
import { StartupTracker } from './startup'
import type { SecretStore } from './store/secretStore'
import type { SettingsStore } from './store/settingsStore'

export type Send = (channel: string, payload: unknown) => void

export interface SessionDeps {
  manager: ConnectionManager
  store: SettingsStore
  secrets: Pick<SecretStore, 'status' | 'encrypt' | 'decrypt'>
  collectorScript: string
  send: Send
  log?: (msg: string) => void
  backoff?: (attempt: number) => number
  latencyIntervalMs?: number
}

const IDLE: ConnStatus = { state: 'idle', latencyMs: null, hermesVersion: null, attempt: 0, nextRetryInS: null, error: null }
const BLOCKING: ConnectErrorKind[] = ['hostkey-changed', 'hostkey-unverified', 'auth', 'hermes-missing']
const PENDING_TTL_MS = 120_000

interface Hermes {
  home: string
  hermesPath: string | null
  python: string
}

interface Pending {
  host: string
  port: number
  username: string
  password: string
  at: number
}

const fail = (kind: ConnectErrorKind, message: string): ConnectResult => ({ ok: false, kind, message })

export class MissionSession {
  private params: ConnectParams | null = null
  private remember = true
  private autoRetry = false
  private hermes: Hermes | null = null
  private collector: CollectorChannel | null = null
  private models: ModelResolver | null = null
  private status: ConnStatus = { ...IDLE }
  private retryTimer: NodeJS.Timeout | null = null
  private latencyTimer: NodeJS.Timeout | null = null
  private collectorTimer: NodeJS.Timeout | null = null
  private everConnected = false
  private blocked = false
  private generation = 0
  /** Password held only in memory so a host key can be trusted without retyping it. */
  private pending: Pending | null = null

  constructor(private readonly d: SessionDeps) {
    d.manager.on('close', () => this.onUnexpectedClose())
  }

  private log = (m: string): void => this.d.log?.(m)
  private backoff = (n: number): number => (this.d.backoff ?? backoffDelay)(n)

  getStatus(): ConnStatus {
    return this.status
  }

  getSaved(): SavedConnection | null {
    return this.d.store.getConnection()
  }

  secretStatus(): { canRemember: boolean; reason: string | null } {
    const s = this.d.secrets.status()
    return { canRemember: s.available, reason: s.reason }
  }

  trustHostKey(c: HostKeyChallenge): void {
    this.d.store.trustHost(c.host, c.port, c.algo, c.fingerprint)
  }

  private setStatus(partial: Partial<ConnStatus>): void {
    this.status = { ...this.status, ...partial }
    this.d.send(IPC.evStatus, this.status)
  }

  async connect(req: ConnectRequest): Promise<ConnectResult> {
    const gen = ++this.generation
    await this.teardown()
    this.blocked = false
    this.everConnected = false
    this.autoRetry = req.useSaved === true
    this.remember = req.remember
    this.setStatus({ ...IDLE, state: 'connecting' })

    let password = req.password ?? ''
    let fromKeychain = false
    const saved = this.d.store.getConnection()
    const sameTarget = !!saved && saved.host === req.host && saved.port === req.port && saved.username === req.username
    if (!password && sameTarget) {
      const enc = this.d.store.getPasswordEnc()
      const plain = enc ? this.d.secrets.decrypt(enc) : null
      if (plain) {
        password = plain
        fromKeychain = true
      }
    }
    const p = this.pending
    if (!password && p && p.host === req.host && p.port === req.port && p.username === req.username && Date.now() - p.at < PENDING_TTL_MS) {
      password = p.password
    }

    const startup = new StartupTracker((s) => this.d.send(IPC.evStartup, s), fromKeychain)
    startup.begin('credentials')
    if (!password) {
      startup.fail('credentials', 'no password')
      this.setStatus({ ...IDLE })
      return fail('auth', 'Enter the password to connect.')
    }
    startup.done('credentials', fromKeychain ? 'from keychain' : '')

    const params: ConnectParams = { host: req.host, port: req.port, username: req.username, password }
    this.params = params
    const result = await this.establish(params, startup, gen, true)
    if (gen !== this.generation) return fail('unknown', 'Connection attempt was cancelled.')
    if (result.ok || !result.kind.startsWith('hostkey')) this.pending = null
    else this.pending = { host: params.host, port: params.port, username: params.username, password: params.password, at: Date.now() }
    if (!result.ok) this.afterFailedConnect(result)
    return result
  }

  private afterFailedConnect(r: Extract<ConnectResult, { ok: false }>): void {
    const retryable = r.kind === 'unreachable' || r.kind === 'timeout'
    if (this.autoRetry && retryable) {
      this.scheduleRetry(0)
      this.setStatus({ error: r.message })
      return
    }
    this.params = null
    this.setStatus({ ...IDLE, error: r.message })
  }

  private async establish(params: ConnectParams, startup: StartupTracker, gen: number, persist: boolean): Promise<ConnectResult> {
    startup.begin('handshake')
    let fingerprint: string
    try {
      fingerprint = (await this.d.manager.connect(params)).fingerprint
    } catch (e) {
      startup.fail('handshake', e instanceof Error ? e.message : String(e))
      if (e instanceof HostKeyError) {
        return {
          ok: false,
          kind: e.challenge.changed ? 'hostkey-changed' : 'hostkey-unverified',
          message: e.challenge.changed
            ? 'The host key has changed since you last connected. Verify it before continuing.'
            : 'This is the first connection to this host. Verify its key to continue.',
          hostKey: e.challenge
        }
      }
      if (e instanceof ConnectError) return fail(e.kind, e.message)
      return fail('unknown', e instanceof Error ? e.message : String(e))
    }
    if (gen !== this.generation) {
      await this.d.manager.disconnect()
      return fail('unknown', 'Connection attempt was cancelled.')
    }

    const latencyMs = await this.d.manager.measureLatency().catch(() => 0)
    startup.done('handshake', `${fingerprint.slice(0, 15)}… · ${latencyMs}ms`)

    startup.begin('hermes')
    const pre = await runPreflight(this.d.manager, { host: params.host, port: params.port, username: params.username, latencyMs, fingerprint })
    this.d.send(IPC.evPreflight, pre)
    if (!pre.canStart || !pre.hermesHome || !pre.pythonPath) {
      startup.fail('hermes', 'Hermes home or Python not found')
      await this.d.manager.disconnect()
      return {
        ok: false,
        kind: 'hermes-missing',
        message: 'Hermes was not found on this server for this SSH user. See the preflight checklist.',
        preflight: pre
      }
    }
    startup.done('hermes', `${pre.version ? 'v' + pre.version : 'version unknown'} · ${pre.profileCount} profiles`)
    startup.begin('statedb')
    const db = pre.items.find((i) => i.id === 'statedb')
    if (db?.state === 'fail') startup.fail('statedb', db.result)
    else startup.done('statedb', db?.result ?? '')

    this.hermes = { home: pre.hermesHome, hermesPath: pre.hermesPath, python: pre.pythonPath }
    this.models = new ModelResolver(this.d.manager, pre.hermesPath, (m) => this.d.send(IPC.evModels, m))

    if (persist) {
      const store = this.d.store
      const canKeep = this.remember && this.d.secrets.status().available
      const id = store.upsertConnection({
        name: `${params.username}@${params.host}`,
        host: params.host,
        port: params.port,
        username: params.username,
        remember: this.remember,
        passwordEnc: canKeep ? this.d.secrets.encrypt(params.password) : null
      })
      store.touchConnected(id, Date.now())
    }

    startup.begin('collector')
    try {
      await this.startCollector()
    } catch (e) {
      startup.fail('collector', e instanceof Error ? e.message : String(e))
      await this.d.manager.disconnect()
      return fail('unknown', 'The monitoring collector could not be started.')
    }
    startup.done('collector', '0 files written')

    this.everConnected = true
    this.startLatency()
    this.setStatus({ state: 'connected', hermesVersion: pre.version, latencyMs, attempt: 0, nextRetryInS: null, error: null })
    void probeCapabilities(this.d.manager, pre.hermesPath, pre.version).then((caps) => {
      if (gen === this.generation) this.d.send(IPC.evCapabilities, caps)
    })
    return { ok: true, preflight: pre }
  }

  private async startCollector(): Promise<void> {
    const h = this.hermes
    if (!h) return
    const ch = new CollectorChannel(this.d.manager, { python: h.python, home: h.home, script: this.d.collectorScript, log: this.log })
    ch.on('event', (ev: CollectorEvent) => {
      this.d.send(IPC.evEvent, ev)
      if (ev.type === 'agents') void this.models?.update(ev.data.agents)
    })
    ch.on('closed', () => {
      if (this.collector !== ch) return
      this.collector = null
      if (this.d.manager.isConnected()) {
        this.log('collector stopped while connected; restarting')
        this.collectorTimer = setTimeout(() => {
          if (this.d.manager.isConnected() && !this.collector) {
            void this.startCollector().catch((e) => this.log(`collector restart failed: ${String(e)}`))
          }
        }, 3000)
        this.collectorTimer.unref()
      }
    })
    this.collector = ch
    await ch.start()
  }

  private startLatency(): void {
    this.stopLatency()
    const every = this.d.latencyIntervalMs ?? 5000
    this.latencyTimer = setInterval(() => {
      this.d.manager
        .measureLatency()
        .then((ms) => this.setStatus({ latencyMs: ms }))
        .catch(() => {})
    }, every)
    this.latencyTimer.unref()
  }

  private stopLatency(): void {
    if (this.latencyTimer) clearInterval(this.latencyTimer)
    this.latencyTimer = null
  }

  private stopCollector(): void {
    if (this.collectorTimer) clearTimeout(this.collectorTimer)
    this.collectorTimer = null
    this.collector?.stop()
    this.collector = null
  }

  private onUnexpectedClose(): void {
    if (!this.params) return
    this.stopLatency()
    this.stopCollector()
    this.scheduleRetry(0)
  }

  private scheduleRetry(attempt: number): void {
    if (!this.params || this.blocked) return
    const delay = this.backoff(attempt)
    this.setStatus({
      state: this.everConnected ? 'reconnecting' : 'offline',
      attempt: attempt + 1,
      nextRetryInS: Math.max(1, Math.ceil(delay / 1000))
    })
    const gen = this.generation
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(() => void this.retry(attempt, gen), delay)
    this.retryTimer.unref()
  }

  private async retry(attempt: number, gen: number): Promise<void> {
    const params = this.params
    if (!params || gen !== this.generation) return
    const res = await this.establish(params, new StartupTracker(() => {}, false), gen, false)
    if (gen !== this.generation) return
    if (res.ok) return
    if (BLOCKING.includes(res.kind)) {
      this.blocked = true
      this.setStatus({ state: 'offline', error: res.message, nextRetryInS: null })
      return
    }
    this.scheduleRetry(attempt + 1)
  }

  private async teardown(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.stopLatency()
    this.stopCollector()
    this.models = null
    this.hermes = null
    await this.d.manager.disconnect()
  }

  async disconnect(): Promise<void> {
    this.generation++
    this.params = null
    this.pending = null
    await this.teardown()
    this.everConnected = false
    this.setStatus({ ...IDLE })
  }

  async forget(): Promise<void> {
    await this.disconnect()
    this.d.store.forgetConnection()
  }
}
