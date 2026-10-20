import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import { UploadsList, BrowseResult, ChatSessions, FeedHistory, FeedMessageText, InteractionDetail, NoteText, ObsidianGraphResult, SessionDetail, SessionsList, SessionTranscript, UsageSummary, UsageTools, LogsList, LogsRead, KanbanBoards, KanbanTasks, KanbanTaskDetail, VaultCheck, CronData, CronRuns, CronOutputFiles, SkillsList, SkillText, SkillsLedger, SkillBlobs } from '@shared/events'
import type { CostAlertState } from '@shared/events'
import type { KanbanActionRequest, KanbanActionResult, KanbanTaskArgs, KanbanTasksArgs } from '@shared/kanban'
import { KanbanActionService } from './kanban/actions'
import type { ApprovalsResult, GatewayAction, GatewayActionResult, LogsListArgs, LogsReadArgs } from '@shared/logs'
import type { UsageSummaryArgs, UsageToolsArgs } from '@shared/usage'
import type { ExportExt, ExportResult, SessionAction, SessionActionResult, SessionsListArgs, SessionsSearchArgs, TranscriptArgs } from '@shared/sessions'
import type { BrowserWindow } from 'electron'
import type {
  ConnStatus, ConnectErrorKind, ConnectRequest, ConnectResult, HostKeyChallenge, InteractionDetailArgs, PickKeyResult, QueryResult, SavedConnection
} from '@shared/ipc'
import { cleanLabel, LABEL_PROBLEM } from '@shared/ipc'
import { BrainService } from './brain/service'
import { AgentFileService } from './agentcfg/files'
import { ModelService } from './agentcfg/model'
import { SessionActionService } from './sessions/actions'
import { nativeSaveDialog, saveExport, type SaveDialog } from './sessions/export'
import { AgentOpsService } from './agentops/service'
import type { BackupRequest, BackupResult, NewProfileRequest, OpsApply, OpsText, ToolChange } from '@shared/agentOps'
import { CostAlertService } from './usage/costAlert'
import { ApprovalsService } from './approvals/service'
import { GatewayService } from './gateway/service'
import { GatewayWatcher, type GatewayAlert } from './gateway/watcher'
import { ChatService } from './chat/service'
import { UploadService } from './uploads/service'
import type { AgentFileKind, ModelSaveRequest } from '@shared/agentCfg'
import { FeedCursors } from './feed/cursors'
import { QueryRunner } from './query'
import { CollectorChannel } from './collector/channel'
import { ModelResolver } from './collector/models'
import { CronActionService } from './cron/actions'
import { SkillActionService } from './skills/actions'
import { MemorySnapshots } from './memory/snapshots'
import { TerminalService } from './terminal/service'
import type { TermInfo, TermOpenRequest, TermOpenResult, TermSize } from '@shared/terminal'
import type { TerminalDeps } from './terminal/service'
import type { MemoryVersion, MemoryVersionText } from '@shared/memory'
import type { SkillActionRequest, SkillActionResult, SkillTextResult } from '@shared/skills'
import type { CronActionRequest, CronActionResult } from '@shared/cron'
import { CronStore } from './cron/store'
import { CronWatcher, type CronAlert } from './cron/watcher'
import { backoffDelay } from './connection/backoff'
import { probeCapabilities } from './connection/capabilities'
import { ConnectError, HostKeyError } from './connection/errors'
import { inspectKey, keyInfoOf, readKeyFile } from './connection/keyFile'
import type { ConnectParams, ConnectionManager } from './connection/manager'
import { runPreflight } from './connection/preflight'
import { StartupTracker } from './startup'
import { GroupService } from './groups/service'
import type { GroupEntry, GroupList, GroupRoom, GroupSendResult } from '@shared/groups'
import type { SecretStore } from './store/secretStore'
import { TargetTakenError, type SettingsStore } from './store/settingsStore'
import { CatalogService, type FetchUrl } from './agentcfg/catalog'
import { AuxService } from './agentcfg/auxService'
import type { AuxReadResult, AuxSaveRequest, AuxSaveResult } from '@shared/auxModels'
import { CatalogQueryResult, type CatalogResult } from '@shared/modelCatalog'

export type Send = (channel: string, payload: unknown) => void

export interface SessionDeps {
  manager: ConnectionManager
  store: SettingsStore
  secrets: Pick<SecretStore, 'status' | 'encrypt' | 'decrypt'>
  collectorScript: string
  send: Send
  log?: (msg: string) => void
  /** Called once per newly failed cron run (after the baseline). */
  notify?: (alert: CronAlert) => void
  /** Called once per local day when the daily cost passes the alert threshold. */
  notifyCost?: (state: CostAlertState) => void
  /** Called once per gateway or platform that went from healthy to failed (after the baseline). */
  notifyGateway?: (alert: GatewayAlert) => void
  backoff?: (attempt: number) => number
  /** The native file picker for attachments; returns local paths. */
  pickFiles?: () => Promise<string[]>
  /** A small data: URL for an image file. */
  makeThumb?: (path: string) => string | undefined
  /** How long a stopped chat turn may take to end on its own before its channel is closed (tests make it short). */
  chatStopGraceMs?: number
  /** How long the chat gateway may take to get ready (tests make it short). */
  gatewayReadyMs?: number
  /** Extra collector arguments (tests shorten the memory interval). */
  collectorArgs?: string[]
  /** Local terminals and the system ssh (the app passes them; most tests leave them out and get built-in shells only). */
  terminalLocal?: TerminalDeps['local']
  /** The save dialog of exports and backups (tests answer it themselves). */
  saveDialog?: SaveDialog
  /** The open dialog for a private key file (F-CONN-7); null when cancelled. Tests and the E2E answer it themselves. */
  openKeyDialog?: () => Promise<string | null>
  /** Fetches the public model catalog from this computer (v2); without it only the server's cache is used. */
  fetchUrl?: FetchUrl
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

type Creds = { method: 'password'; password: string } | { method: 'key'; keyPath: string; passphrase: string }

interface Pending {
  host: string
  port: number
  username: string
  creds: Creds
  at: number
}

type Resolved = { ok: true; params: ConnectParams; fromKeychain: boolean; detail: string; logLine: string } | { ok: false; message: string; detail: string }

const credsOf = (p: ConnectParams): Creds =>
  'password' in p ? { method: 'password', password: p.password } : { method: 'key', keyPath: p.keyPath, passphrase: p.passphrase ?? '' }

const fail = (kind: ConnectErrorKind, message: string): ConnectResult => ({ ok: false, kind, message })

/** A saved server with facts about its key file as it is now (null when the file is gone or unreadable). */
function withKeyInfo(c: SavedConnection): SavedConnection {
  if (c.authMethod !== 'key' || !c.keyPath) return c
  const file = readKeyFile(c.keyPath)
  const check = file.ok ? inspectKey(file.data) : null
  return { ...c, keyInfo: check?.ok ? keyInfoOf(c.keyPath, check.facts) : null }
}

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
  /** Password or passphrase held only in memory so a host key can be trusted without retyping it. */
  private pending: Pending | null = null
  /** Key files returned by the open dialog in this run: the only paths a connect request may name besides the saved one. */
  private readonly keyPicks = new Set<string>()
  private readonly cronStore = new CronStore()
  private readonly cronWatcher = new CronWatcher()
  /** The server the in-memory state (cron, feed cursors, watchers) belongs to: `<row id|new>|host:port:user`. */
  private lastTarget: string | null = null
  /** The saved server of the current connect request and its label (F-CONN-14); a new server has no id yet. */
  private want: { id: number | undefined; name: string | undefined } = { id: undefined, name: undefined }
  private readonly feedCursors = new FeedCursors()
  private readonly queries: QueryRunner
  private readonly brain: BrainService
  private readonly chat: ChatService
  private readonly uploads: UploadService
  private readonly agentFiles: AgentFileService
  private readonly agentModel: ModelService
  private readonly catalog: CatalogService
  private readonly aux: AuxService
  private readonly sessionActions: SessionActionService
  private readonly costAlert: CostAlertService
  private readonly gatewayWatcher = new GatewayWatcher()
  private readonly gateways: GatewayService
  private readonly approvals: ApprovalsService
  private readonly cronActions: CronActionService
  private readonly kanbanActions: KanbanActionService
  private readonly skillActions: SkillActionService
  private readonly memory: MemorySnapshots
  private readonly agentOps: AgentOpsService
  private readonly terminal: TerminalService
  private readonly groups: GroupService
  /** Profiles and Hermes display names from the latest agents event (null before the first one). */
  private agentNames: Record<string, string> | null = null

  constructor(private readonly d: SessionDeps) {
    d.manager.on('close', () => this.onUnexpectedClose())
    this.brain = new BrainService({
      conn: d.manager,
      script: d.collectorScript,
      onEvent: (ev) => d.send(IPC.evEvent, ev),
      log: (m) => d.log?.(m)
    })
    this.uploads = new UploadService({
      conn: d.manager,
      uploadDir: () => d.store.getSetting('chat.uploadDir'),
      maxMb: () => d.store.getSetting('chat.maxUploadMb'),
      emit: (p) => d.send(IPC.evUpload, p),
      ...(d.pickFiles ? { showOpen: d.pickFiles } : {}),
      ...(d.makeThumb ? { makeThumb: d.makeThumb } : {})
    })
    this.agentFiles = new AgentFileService({ conn: d.manager, home: () => this.hermes?.home ?? null, log: (m) => d.log?.(m) })
    this.catalog = new CatalogService({
      query: (profile) => this.queries.run('model_catalog', { profile }, CatalogQueryResult),
      fetchUrl: d.fetchUrl ?? (() => Promise.reject(new Error('no network access in this run'))),
      log: (m) => d.log?.(m)
    })
    this.aux = new AuxService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath, python: this.hermes.python, home: this.hermes.home } : null),
      isConnected: () => d.manager.isConnected(),
      log: (m) => d.log?.(m)
    })
    this.agentModel = new ModelService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath, python: this.hermes.python } : null),
      isConnected: () => d.manager.isConnected(),
      log: (m) => d.log?.(m)
    })
    this.sessionActions = new SessionActionService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath } : null),
      isConnected: () => d.manager.isConnected(),
      log: (m) => d.log?.(m)
    })
    this.gateways = new GatewayService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath } : null),
      isConnected: () => d.manager.isConnected(),
      log: (m) => d.log?.(m)
    })
    this.cronActions = new CronActionService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath } : null),
      isConnected: () => d.manager.isConnected(),
      store: this.cronStore,
      log: (m) => d.log?.(m)
    })
    this.kanbanActions = new KanbanActionService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath } : null),
      isConnected: () => d.manager.isConnected(),
      profiles: () => (this.agentNames ? Object.keys(this.agentNames) : null),
      log: (m) => d.log?.(m)
    })
    this.agentOps = new AgentOpsService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath } : null),
      home: () => this.hermes?.home ?? null,
      isConnected: () => d.manager.isConnected(),
      log: (m) => d.log?.(m)
    })
    this.terminal = new TerminalService({
      conn: d.manager,
      send: d.send,
      log: (m) => d.log?.(m),
      ...(d.terminalLocal ? { local: d.terminalLocal } : {}),
      serverVia: () => d.store.getSetting('terminal.serverVia')
    })
    this.memory = new MemorySnapshots({
      store: d.store,
      connectionId: () => d.store.getConnection()?.id,
      changed: (profile, file) => d.send(IPC.evMemory, { profile, file })
    })
    this.skillActions = new SkillActionService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath } : null),
      isConnected: () => d.manager.isConnected(),
      log: (m) => d.log?.(m)
    })
    this.approvals = new ApprovalsService({
      conn: d.manager,
      hermes: () => (this.hermes?.hermesPath ? { path: this.hermes.hermesPath } : null),
      isConnected: () => d.manager.isConnected()
    })
    this.costAlert = new CostAlertService({
      query: (a) => this.usageSummary(a),
      settings: () => ({ enabled: this.d.store.getSetting('alerts.cost.enabled'), usd: this.d.store.getSetting('alerts.cost.usd') }),
      isConnected: () => this.d.manager.isConnected() && this.hermes !== null,
      send: (s) => this.d.send(IPC.evCostAlert, s),
      notify: (s) => this.d.notifyCost?.(s)
    })
    this.chat = new ChatService({
      uploads: this.uploads,
      conn: d.manager,
      hermesPath: () => this.hermes?.hermesPath ?? null,
      getSession: (profile) => {
        const id = this.d.store.getConnection()?.id
        return id === undefined ? null : this.d.store.getChatSession(id, profile)
      },
      setSession: (profile, sessionId) => {
        const id = this.d.store.getConnection()?.id
        if (id !== undefined) this.d.store.setChatSession(id, profile, sessionId)
      },
      emit: (e) => d.send(IPC.evChat, e),
      useAcp: () => d.store.getSetting('chat.useAcp'),
      useGateway: () => d.store.getSetting('chat.useGateway'),
      gatewayTarget: () => (this.hermes ? { python: this.hermes.python, home: this.hermes.home } : null),
      ...(d.gatewayReadyMs !== undefined ? { gatewayReadyMs: d.gatewayReadyMs } : {}),
      // the working folder of ACP sessions: the folder that holds ~/.hermes, normally the home of the server user
      acpCwd: () => {
        const parts = (this.hermes?.home ?? '').split('/').filter(Boolean)
        return parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/'
      },
      recentSessions: async (profile, anySource) => {
        const res = await this.queries.run('chat_sessions', { profile, ...(anySource ? { any: true } : {}) }, ChatSessions)
        return res.ok ? res.data.sessions.map((x) => ({ id: x.id, startedAt: x.startedAt })) : []
      },
      log: (m) => d.log?.(m),
      ...(d.chatStopGraceMs !== undefined ? { stopGraceMs: d.chatStopGraceMs } : {})
    })
    this.groups = new GroupService({
      store: d.store.groups,
      runTurn: async (r) => {
        const res = await this.chat.groupTurn({
          profile: r.profile,
          slot: `${r.profile}#${r.groupId}`,
          turn: r.turn,
          message: r.message,
          saved: r.saved,
          create: { title: r.title, hidden: true, room_plumbing: true, follow_profile_config: true },
          emit: r.emit,
          onSession: r.onSession
        })
        if (!res.ok) return res
        return { ok: true, cancel: () => res.handle.cancel(), approve: (a, o) => res.handle.approve(a, o), done: res.handle.done }
      },
      available: () => this.chat.groupsAvailable(),
      isConnected: () => d.manager.isConnected() && this.hermes !== null,
      profiles: () => (this.agentNames ? Object.keys(this.agentNames) : null),
      names: () => this.displayNames(),
      emit: (e) => d.send(IPC.evGroup, e),
      log: (m) => d.log?.(m)
    })
    this.queries = new QueryRunner(d.manager, d.collectorScript, () => (this.hermes && d.manager.isConnected() ? { python: this.hermes.python, home: this.hermes.home } : null), (m) => d.log?.(m))
  }

  private log = (m: string): void => this.d.log?.(m)
  private backoff = (n: number): number => (this.d.backoff ?? backoffDelay)(n)

  getStatus(): ConnStatus {
    return this.status
  }

  getSaved(): SavedConnection | null {
    const c = this.d.store.getConnection()
    return c ? withKeyInfo(c) : null
  }

  /** F-CONN-14: every saved server, the newest connected first. */
  listServers(): SavedConnection[] {
    return this.d.store.listConnections().map(withKeyInfo)
  }

  renameServer(id: number, name: string): { ok: true } | { ok: false; message: string } {
    if (!this.d.store.getConnection(id)) return { ok: false, message: 'This server is no longer saved.' }
    try {
      this.d.store.renameConnection(id, name)
      return { ok: true }
    } catch {
      return { ok: false, message: LABEL_PROBLEM }
    }
  }

  /** F-CONN-7: the user picks a private key file; only facts about it go back to the renderer. */
  async pickKey(): Promise<PickKeyResult> {
    const path = this.d.openKeyDialog ? await this.d.openKeyDialog() : null
    if (!path) return { ok: false, reason: 'cancelled' }
    const file = readKeyFile(path)
    if (!file.ok) return { ok: false, reason: file.reason, message: file.message }
    const check = inspectKey(file.data)
    if (!check.ok) return { ok: false, reason: check.problem === 'ppk3' ? 'ppk3' : 'not-a-key', message: check.message }
    this.keyPicks.add(path)
    return { ok: true, key: keyInfoOf(path, check.facts) }
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
    // F-CONN-14: the saved server this request is for; refused before anything is torn down
    const store = this.d.store
    const row = req.connectionId !== undefined ? store.getConnection(req.connectionId) : store.findConnection(req.host, req.port, req.username)
    if (req.connectionId !== undefined && !row) return fail('unknown', 'This server is no longer saved.')
    const other = row ? store.findConnection(req.host, req.port, req.username) : null
    if (row && other && other.id !== row.id) return fail('unknown', new TargetTakenError().message)
    let name: string | undefined
    try {
      name = req.name === undefined ? undefined : cleanLabel(req.name)
    } catch {
      return fail('unknown', LABEL_PROBLEM)
    }

    const gen = ++this.generation
    await this.teardown()
    store.setActive(row ? row.id : null)
    this.want = { id: row?.id, name }
    this.blocked = false
    this.everConnected = false
    this.autoRetry = req.useSaved === true
    this.remember = req.remember
    this.setStatus({ ...IDLE, state: 'connecting' })

    const resolved = this.credentials(req)
    const startup = new StartupTracker((st) => this.d.send(IPC.evStartup, st), resolved.ok && resolved.fromKeychain)
    startup.begin('credentials')
    if (!resolved.ok) {
      startup.fail('credentials', resolved.detail)
      this.setStatus({ ...IDLE })
      return fail('auth', resolved.message)
    }
    startup.done('credentials', resolved.detail)
    this.log(resolved.logLine)

    const params = resolved.params
    const target = `${row ? row.id : 'new'}|${req.host}:${req.port}:${req.username}`
    if (this.lastTarget !== null && this.lastTarget !== target) {
      // another server (or the same row moved to another address): nothing in memory belongs to it
      this.cronWatcher.reset()
      this.cronStore.clear()
      this.feedCursors.clear()
      this.costAlert.reset()
      this.gatewayWatcher.reset()
      this.cronActions.clear()
      this.agentNames = null
      this.log(`server switch ${row ? row.id : 'new'}`)
    }
    this.lastTarget = target
    this.params = params
    const result = await this.establish(params, startup, gen, true)
    if (gen !== this.generation) return fail('unknown', 'Connection attempt was cancelled.')
    if (result.ok || !result.kind.startsWith('hostkey')) this.pending = null
    else this.pending = { host: params.host, port: params.port, username: params.username, creds: credsOf(params), at: Date.now() }
    if (!result.ok) this.afterFailedConnect(result)
    return result
  }

  /** The sign-in of a connect request: its own secret, else the keychain (same target), else a pending host key prompt. */
  private credentials(req: ConnectRequest): Resolved {
    const saved = this.d.store.getConnection()
    const sameTarget = !!saved && saved.host === req.host && saved.port === req.port && saved.username === req.username
    const method = req.auth ?? (sameTarget && saved ? saved.authMethod : 'password')
    const p = this.pending
    const pending = p && p.host === req.host && p.port === req.port && p.username === req.username && Date.now() - p.at < PENDING_TTL_MS ? p.creds : null
    const target = { host: req.host, port: req.port, username: req.username }
    const fromStore = (): string | null => {
      const enc = this.d.store.getSecretEnc()
      return enc ? this.d.secrets.decrypt(enc) : null
    }

    if (method === 'password') {
      let password = req.password ?? ''
      let fromKeychain = false
      if (!password && sameTarget && saved?.authMethod === 'password') {
        const plain = fromStore()
        if (plain) {
          password = plain
          fromKeychain = true
        }
      }
      if (!password && pending?.method === 'password') password = pending.password
      if (!password) return { ok: false, message: 'Enter the password to connect.', detail: 'no password' }
      return { ok: true, params: { ...target, password }, fromKeychain, detail: fromKeychain ? 'from keychain' : '', logLine: 'auth: password' }
    }

    const keyPath = req.keyPath ?? (sameTarget && saved?.authMethod === 'key' ? saved.keyPath : null)
    if (!keyPath) return { ok: false, message: 'Choose the key file.', detail: 'no key file' }
    if (!this.keyPicks.has(keyPath) && keyPath !== saved?.keyPath) return { ok: false, message: 'Choose the key file again.', detail: 'key file not picked' }
    const file = readKeyFile(keyPath)
    if (!file.ok) return { ok: false, message: file.message, detail: file.reason }
    let passphrase = req.passphrase ?? ''
    let fromKeychain = false
    if (!passphrase && sameTarget && saved?.authMethod === 'key' && saved.keyPath === keyPath) {
      const plain = fromStore()
      if (plain) {
        passphrase = plain
        fromKeychain = true
      }
    }
    if (!passphrase && pending?.method === 'key' && pending.keyPath === keyPath) passphrase = pending.passphrase
    const check = inspectKey(file.data, passphrase || undefined)
    if (!check.ok) return { ok: false, message: check.message, detail: check.problem }
    if (!check.unlocked) return { ok: false, message: 'This key needs its passphrase.', detail: 'needs passphrase' }
    const name = keyInfoOf(keyPath, check.facts).name
    return {
      ok: true,
      params: { ...target, privateKey: file.data, keyPath, keyFormat: check.facts.format, ...(check.facts.encrypted ? { passphrase } : {}) },
      fromKeychain,
      detail: `key ${name}${fromKeychain ? ' · passphrase from keychain' : ''}`,
      logLine: `auth: key ${check.facts.type} ${check.facts.fingerprint ?? ''}`.trimEnd()
    }
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
      const secret = 'password' in params ? params.password : (params.passphrase ?? null)
      const id = store.upsertConnection({
        ...(this.want.id !== undefined ? { id: this.want.id } : {}),
        ...(this.want.name !== undefined ? { name: this.want.name } : {}),
        host: params.host,
        port: params.port,
        username: params.username,
        remember: this.remember,
        authMethod: 'password' in params ? 'password' : 'key',
        keyPath: 'password' in params ? null : params.keyPath,
        secretEnc: canKeep && secret ? this.d.secrets.encrypt(secret) : null
      })
      store.touchConnected(id, Date.now())
      store.setActive(id)
      this.want = { id, name: undefined }
      this.lastTarget = `${id}|${params.host}:${params.port}:${params.username}`
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
    this.startBrain()
    this.costAlert.start()

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
    const cursors = this.feedCursors.toArg()
    const ch = new CollectorChannel(this.d.manager, {
      python: h.python,
      home: h.home,
      script: this.d.collectorScript,
      extraArgs: [...(cursors ? ['--cursors', cursors] : []), ...(this.d.collectorArgs ?? [])],
      log: this.log
    })
    this.memory.reset()
    ch.on('event', (ev: CollectorEvent) => {
      // memory file contents stay in the main process: they become local versions, the renderer asks for them
      if (ev.type === 'memory') return this.memory.ingest(ev.data)
      this.d.send(IPC.evEvent, ev)
      if (ev.type === 'agents') {
        this.agentNames = Object.fromEntries(ev.data.agents.map((a) => [a.profile, a.displayName]))
        void this.models?.update(ev.data.agents)
        const gateway = this.gatewayWatcher.ingest(ev.data.agents)
        if (this.d.store.getSetting('alerts.gateway.enabled')) for (const alert of gateway) this.d.notifyGateway?.(alert)
      }
      if (ev.type === 'feed') this.feedCursors.apply(ev.data.cursors)
      if (ev.type === 'cron') this.applyCron(ev.data)
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

  private startBrain(): void {
    const h = this.hermes
    const id = this.d.store.getConnection()?.id
    if (h && id !== undefined) this.brain.attach({ python: h.python, home: h.home }, this.d.store.getVault(id))
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
    this.costAlert.stop()
    this.brain.detach()
    this.groups.dispose()
    this.chat.dispose()
    this.terminal.closeAll()
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
    this.brain.detach()
    this.groups.dispose()
    this.chat.dispose()
    this.terminal.closeAll()
    this.uploads.reset()
    this.agentModel.reset()
    this.models = null
    this.hermes = null
    await this.d.manager.disconnect()
  }

  async disconnect(): Promise<void> {
    this.generation++
    this.params = null
    this.pending = null
    this.costAlert.reset()
    this.gatewayWatcher.reset()
    this.cronActions.clear()
    await this.teardown()
    this.everConnected = false
    this.setStatus({ ...IDLE })
  }

  /** Forgets a saved server (the active one without an id); only the active one is disconnected first. */
  async forget(id?: number): Promise<void> {
    const store = this.d.store
    const active = store.activeId()
    const target = id ?? active
    if (target === null) return
    if (target === active) {
      await this.disconnect()
      this.cronWatcher.reset()
      this.cronStore.clear()
      this.feedCursors.clear()
      this.lastTarget = null
    }
    store.forgetConnection(target)
    this.log(`server forget ${target}`)
  }

  /** The Terminal panel (F-TERM-1): an interactive shell; only the user's keys go into it. */
  termOpen(req: TermOpenRequest): Promise<TermOpenResult> {
    return this.terminal.open(req)
  }

  termInfo(): TermInfo {
    return this.terminal.info()
  }

  /** The app quits: local terminals end with it. */
  termKillAll(): void {
    this.terminal.killAll()
  }

  termWrite(id: string, data: string): boolean {
    return this.terminal.write(id, data)
  }

  termResize(id: string, size: TermSize): void {
    this.terminal.resize(id, size)
  }

  termClose(id: string): void {
    this.terminal.close(id)
  }

  feedMessage(args: { profile: string; messageId: number; field: 'content' | 'reasoning' | 'tool_calls'; index?: number }): Promise<QueryResult<FeedMessageText>> {
    return this.queries.run('message', args, FeedMessageText)
  }

  feedHistory(args: { before: Record<string, number>; limit: number }): Promise<QueryResult<FeedHistory>> {
    return this.queries.run('history', args, FeedHistory)
  }

  feedSession(args: { profile: string; sessionId: string }): Promise<QueryResult<SessionDetail>> {
    return this.queries.run('session', args, SessionDetail)
  }

  sessionsList(args: SessionsListArgs): Promise<QueryResult<SessionsList>> {
    return this.queries.run('sessions_list', args, SessionsList)
  }

  sessionsSearch(args: SessionsSearchArgs): Promise<QueryResult<SessionsList>> {
    return this.queries.run('sessions_search', args, SessionsList)
  }

  sessionsTranscript(args: TranscriptArgs): Promise<QueryResult<SessionTranscript>> {
    return this.queries.run('session_transcript', args, SessionTranscript)
  }

  logsList(args: LogsListArgs): Promise<QueryResult<LogsList>> {
    return this.queries.run('logs_list', args, LogsList)
  }

  logsRead(args: LogsReadArgs): Promise<QueryResult<LogsRead>> {
    return this.queries.run('logs_read', args, LogsRead)
  }

  kanbanBoards(): Promise<QueryResult<KanbanBoards>> {
    return this.queries.run('kanban_boards', {}, KanbanBoards)
  }

  kanbanTasks(args: KanbanTasksArgs): Promise<QueryResult<KanbanTasks>> {
    return this.queries.run('kanban_tasks', args, KanbanTasks)
  }

  kanbanTask(args: KanbanTaskArgs): Promise<QueryResult<KanbanTaskDetail>> {
    return this.queries.run('kanban_task', args, KanbanTaskDetail)
  }

  /** v2 Kanban writes through `hermes kanban --board <slug> ...`, after the user confirmed the command. */
  kanbanAction(req: KanbanActionRequest): Promise<KanbanActionResult> {
    return this.kanbanActions.run(req)
  }

  gatewayAction(req: { action: GatewayAction; profile: string }): Promise<GatewayActionResult> {
    return this.gateways.run(req.action, req.profile)
  }

  approvalsRead(profile: string): Promise<ApprovalsResult> {
    return this.approvals.read(profile)
  }

  alertsRecheck(): Promise<void> {
    return this.costAlert.recheck()
  }

  usageSummary(args: UsageSummaryArgs): Promise<QueryResult<UsageSummary>> {
    return this.queries.run('usage_summary', args, UsageSummary)
  }

  usageTools(args: UsageToolsArgs): Promise<QueryResult<UsageTools>> {
    return this.queries.run('usage_tools', args, UsageTools)
  }

  sessionAction(req: { action: SessionAction; profile: string; sessionId: string; title?: string }): Promise<SessionActionResult> {
    return this.sessionActions.run(req.action, req.profile, req.sessionId, req.title)
  }

  sessionExport(req: { name: string; ext: ExportExt; content: string }, win: BrowserWindow | null): Promise<ExportResult> {
    return saveExport(req, win)
  }

  interactionDetail(args: InteractionDetailArgs): Promise<QueryResult<InteractionDetail>> {
    return this.queries.run('interaction', args, InteractionDetail)
  }

  /** Display names by profile: the local name (Settings → Agents → Profile), else Hermes's. */
  private displayNames(): Record<string, string> {
    const id = this.d.store.getConnection()?.id
    const looks = id === undefined ? {} : this.d.store.getLooks(id)
    const out: Record<string, string> = { ...(this.agentNames ?? {}) }
    for (const [p, l] of Object.entries(looks)) if (l.name) out[p] = l.name
    return out
  }

  groupsList(): GroupList {
    return this.groups.list()
  }

  groupsCreate(req: { name: string; members: string[] }): GroupRoom | { error: string } {
    return this.groups.create(req.name, req.members)
  }

  groupsUpdate(req: { id: string; name?: string; members?: string[] }): GroupRoom | { error: string } {
    return this.groups.update(req.id, { ...(req.name !== undefined ? { name: req.name } : {}), ...(req.members !== undefined ? { members: req.members } : {}) })
  }

  groupsDelete(id: string): void {
    this.groups.remove(id)
  }

  groupsEntries(req: { id: string; before?: number }): GroupEntry[] {
    return this.groups.entries(req.id, req.before)
  }

  groupsSend(req: { id: string; text: string }): Promise<GroupSendResult> {
    return this.groups.send(req.id, req.text)
  }

  groupsStop(id: string): void {
    this.groups.stop(id)
  }

  groupsApprove(req: { turn: string; approval: string; option: string | null }): boolean {
    return this.groups.approve(req.turn, req.approval, req.option)
  }

  groupsClear(): void {
    this.groups.clear()
  }

  /** The notice for a room run that ended while the room was not on screen. */
  groupNotice(id: string, replies: number, needsYou: string | null): { title: string; body: string } | null {
    const room = this.d.store.groups.get(id)
    if (!room) return null
    if (needsYou) return { title: room.name, body: `${this.displayNames()[needsYou] ?? needsYou} needs you` }
    if (replies === 0) return null
    return { title: room.name, body: replies === 1 ? '1 new reply' : `${replies} new replies` }
  }

  chatSend(req: { profile: string; text: string; attachmentIds: string[] }): ReturnType<ChatService['send']> {
    return this.chat.send(req)
  }

  chatStop(turn: string): void {
    this.chat.stop(turn)
  }

  chatApprove(req: { turn: string; approval: string; option: string | null }): boolean {
    return this.chat.approve(req.turn, req.approval, req.option)
  }

  chatGetSession(profile: string): string | null {
    const id = this.d.store.getConnection()?.id
    return id === undefined ? null : this.d.store.getChatSession(id, profile)
  }

  chatSetSession(profile: string, sessionId: string | null): void {
    this.chat.setSession(profile, sessionId)
  }

  chatPick(): ReturnType<UploadService['pick']> {
    return this.uploads.pick()
  }

  chatAttach(paths: string[]): ReturnType<UploadService['register']> {
    return this.uploads.register(paths)
  }

  chatDetach(id: string): void {
    this.uploads.detach(id)
  }

  uploadsCancel(id: string): void {
    this.uploads.cancel(id)
  }

  async uploadsList(): Promise<QueryResult<UploadsList>> {
    if (!this.hermes || !this.d.manager.isConnected()) return { ok: false, error: 'not-connected' }
    return this.queries.run('uploads_list', { dir: await this.uploads.baseDir().catch(() => '~/hermes-uploads') }, UploadsList)
  }

  uploadsRemove(path: string): ReturnType<UploadService['remove']> {
    return this.uploads.remove(path)
  }

  chatSessions(profile: string): Promise<QueryResult<ChatSessions>> {
    return this.queries.run('chat_sessions', { profile }, ChatSessions)
  }

  chatBackend(profile: string): Promise<string | null> {
    return this.chat.backend(profile)
  }

  agentReadFile(profile: string, kind: AgentFileKind): ReturnType<AgentFileService['read']> {
    return this.agentFiles.read(profile, kind)
  }

  async agentWriteFile(profile: string, kind: AgentFileKind, text: string, baseHash: string | null): ReturnType<AgentFileService['write']> {
    this.memory.expectSave(profile, kind, text)
    const res = await this.agentFiles.write(profile, kind, text, baseHash)
    if (res.ok) this.memory.recordSave(profile, kind, res.file.text, res.file.mtime)
    return res
  }

  memoryVersions(profile: string, file: AgentFileKind): MemoryVersion[] {
    return this.memory.versions(profile, file)
  }

  memoryVersion(id: number): MemoryVersionText {
    return this.memory.version(id)
  }

  memoryClear(): number {
    return this.memory.clear()
  }

  mcpList(profile: string): Promise<OpsText> {
    return this.agentOps.mcpList(profile)
  }

  mcpTest(profile: string, name: string): Promise<OpsText> {
    return this.agentOps.mcpTest(profile, name)
  }

  fallbackList(profile: string): Promise<OpsText> {
    return this.agentOps.fallbackList(profile)
  }

  toolsList(profile: string, platforms: string[]): Promise<Record<string, OpsText>> {
    return this.agentOps.toolsList(profile, platforms)
  }

  toolsApply(profile: string, changes: ToolChange[]): Promise<OpsApply> {
    return this.agentOps.toolsApply(profile, changes)
  }

  profileCreate(req: NewProfileRequest): Promise<OpsText> {
    return this.agentOps.profileCreate(req)
  }

  agentBackup(req: BackupRequest, win: BrowserWindow | null): Promise<BackupResult> {
    const pick = this.d.saveDialog ?? nativeSaveDialog
    return this.agentOps.backup(req, (defaultPath) => pick(win, { defaultPath, filters: [{ name: 'Zip archive', extensions: ['zip'] }] }))
  }

  agentReadModel(profile: string): ReturnType<ModelService['read']> {
    return this.agentModel.read(profile)
  }

  agentFetchModels(req: { baseUrl: string; apiKey?: string }): ReturnType<ModelService['fetchModels']> {
    return this.agentModel.fetchModels(req)
  }

  agentSaveModel(req: ModelSaveRequest): ReturnType<ModelService['save']> {
    return this.agentModel.save(req)
  }

  agentTestModel(profile: string): ReturnType<ModelService['test']> {
    return this.agentModel.test(profile)
  }

  agentKeyAsArgument(): Promise<boolean> {
    return this.agentModel.keyTravelsAsArgument()
  }

  agentRestartGateway(profile: string): ReturnType<ModelService['restartGateway']> {
    return this.agentModel.restartGateway(profile)
  }

  /** v2: the Hermes model catalog (server cache, else the public manifest from this computer). */
  agentCatalog(profile: string): Promise<CatalogResult> {
    return this.catalog.get(profile)
  }

  /** v2 auxiliary model slots of an agent. */
  agentAuxRead(profile: string): Promise<AuxReadResult> {
    return this.aux.read(profile)
  }

  agentAuxSave(req: AuxSaveRequest): Promise<AuxSaveResult> {
    return this.aux.save(req)
  }

  brainGet(): { vault: string | null } {
    const id = this.d.store.getConnection()?.id
    return { vault: id === undefined ? null : this.d.store.getVault(id) }
  }

  brainSetVault(path: string | null): void {
    const id = this.d.store.getConnection()?.id
    if (id === undefined) return
    this.d.store.setVault(id, path)
    this.brain.setVault(path)
  }

  brainValidate(path: string): Promise<QueryResult<VaultCheck>> {
    return this.queries.run('vault_check', { path }, VaultCheck)
  }

  brainBrowse(path: string): Promise<QueryResult<BrowseResult>> {
    return this.queries.run('browse', { path }, BrowseResult)
  }

  /** The vault root always comes from the saved setting, never from the renderer. */
  brainNote(id: string): Promise<QueryResult<NoteText>> {
    const root = this.brainGet().vault
    if (!root) return Promise.resolve({ ok: false, error: 'not_found' })
    return this.queries.run('note', { root, id }, NoteText)
  }

  /** F-BRAIN-10: the Obsidian graph settings of the saved vault (root from the setting, never from the renderer). */
  brainObsidian(): Promise<QueryResult<ObsidianGraphResult>> {
    const root = this.brainGet().vault
    if (!root) return Promise.resolve({ ok: false, error: 'not_found' })
    return this.queries.run('vault_graph', { root }, ObsidianGraphResult)
  }

  private applyCron(data: CronData): void {
    this.cronStore.apply(data.jobs)
    for (const alert of this.cronWatcher.ingest(data.jobs)) this.d.notify?.(alert)
  }

  /** One cron write after the user confirmed it, then a fresh snapshot so counts and states follow at once (F-CRON-12). */
  async cronAction(req: CronActionRequest): Promise<CronActionResult> {
    const res = await this.cronActions.run(req)
    if (res.ok || res.error === 'failed') await this.refreshCron()
    return res
  }

  /** Reads the cron jobs now (the collector polls every 10 s) and hands them on like a collector event. */
  async refreshCron(): Promise<void> {
    const res = await this.queries.run('cron_jobs', {}, CronData)
    if (!res.ok) return
    this.applyCron(res.data)
    this.d.send(IPC.evEvent, { type: 'cron', ts: Date.now() / 1000, profile: null, data: res.data } satisfies CollectorEvent)
  }

  cronRuns(args: { profile: string; jobId: string; limit: number }): Promise<QueryResult<CronRuns>> {
    return this.queries.run('cron_runs', args, CronRuns)
  }

  cronRunOutput(args: { profile: string; jobId: string; names: string[] }): Promise<QueryResult<CronOutputFiles>> {
    return this.queries.run('cron_output', args, CronOutputFiles)
  }

  skillsList(args: { profiles: string[] }): Promise<QueryResult<SkillsList>> {
    return this.queries.run('skills_list', args, SkillsList)
  }

  skillRead(args: { profile: string; path: string }): Promise<QueryResult<SkillText>> {
    return this.queries.run('skill_read', args, SkillText)
  }

  skillsLedger(args: { profile: string; limit: number }): Promise<QueryResult<SkillsLedger>> {
    return this.queries.run('skills_ledger', args, SkillsLedger)
  }

  skillsBlobs(args: { profile: string; shas: string[] }): Promise<QueryResult<SkillBlobs>> {
    return this.queries.run('skills_blobs', args, SkillBlobs)
  }

  skillAction(req: SkillActionRequest): Promise<SkillActionResult> {
    return this.skillActions.run(req)
  }

  skillInspect(profile: string, id: string): Promise<SkillTextResult> {
    return this.skillActions.inspect(profile, id)
  }

  curatorStatus(profile: string): Promise<SkillTextResult> {
    return this.skillActions.curatorStatus(profile)
  }
}
