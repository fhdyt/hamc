import { IPC } from '@shared/channels'
import type { CollectorEvent } from '@shared/events'
import { UploadsList, BrowseResult, ChatSessions, FeedHistory, FeedMessageText, InteractionDetail, NoteText, SessionDetail, SessionsList, SessionTranscript, UsageSummary, UsageTools, VaultCheck } from '@shared/events'
import type { CostAlertState } from '@shared/events'
import type { UsageSummaryArgs, UsageToolsArgs } from '@shared/usage'
import type { ExportExt, ExportResult, SessionAction, SessionActionResult, SessionsListArgs, SessionsSearchArgs, TranscriptArgs } from '@shared/sessions'
import type { BrowserWindow } from 'electron'
import type {
  ConnStatus, ConnectErrorKind, ConnectRequest, ConnectResult, CronOutputResult, HostKeyChallenge, InteractionDetailArgs, QueryResult, SavedConnection
} from '@shared/ipc'
import { BrainService } from './brain/service'
import { AgentFileService } from './agentcfg/files'
import { ModelService } from './agentcfg/model'
import { SessionActionService } from './sessions/actions'
import { saveExport } from './sessions/export'
import { CostAlertService } from './usage/costAlert'
import { ChatService } from './chat/service'
import { UploadService } from './uploads/service'
import type { AgentFileKind, ModelSaveRequest } from '@shared/agentCfg'
import { FeedCursors } from './feed/cursors'
import { QueryRunner } from './query'
import { CollectorChannel } from './collector/channel'
import { ModelResolver } from './collector/models'
import { readCronOutput } from './cron/output'
import { CronStore } from './cron/store'
import { CronWatcher, type CronAlert } from './cron/watcher'
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
  /** Called once per newly failed cron run (after the baseline). */
  notify?: (alert: CronAlert) => void
  /** Called once per local day when the daily cost passes the alert threshold. */
  notifyCost?: (state: CostAlertState) => void
  backoff?: (attempt: number) => number
  /** The native file picker for attachments; returns local paths. */
  pickFiles?: () => Promise<string[]>
  /** A small data: URL for an image file. */
  makeThumb?: (path: string) => string | undefined
  /** How long a stopped chat turn may take to end on its own before its channel is closed (tests make it short). */
  chatStopGraceMs?: number
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
  private readonly cronStore = new CronStore()
  private readonly cronWatcher = new CronWatcher()
  private lastTarget: string | null = null
  private readonly feedCursors = new FeedCursors()
  private readonly queries: QueryRunner
  private readonly brain: BrainService
  private readonly chat: ChatService
  private readonly uploads: UploadService
  private readonly agentFiles: AgentFileService
  private readonly agentModel: ModelService
  private readonly sessionActions: SessionActionService
  private readonly costAlert: CostAlertService

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
    this.queries = new QueryRunner(d.manager, d.collectorScript, () => (this.hermes && d.manager.isConnected() ? { python: this.hermes.python, home: this.hermes.home } : null), (m) => d.log?.(m))
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
    const target = `${req.host}:${req.port}:${req.username}`
    if (this.lastTarget !== null && this.lastTarget !== target) {
      this.cronWatcher.reset()
      this.cronStore.clear()
      this.feedCursors.clear()
    }
    this.lastTarget = target
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
      extraArgs: cursors ? ['--cursors', cursors] : [],
      log: this.log
    })
    ch.on('event', (ev: CollectorEvent) => {
      this.d.send(IPC.evEvent, ev)
      if (ev.type === 'agents') void this.models?.update(ev.data.agents)
      if (ev.type === 'feed') this.feedCursors.apply(ev.data.cursors)
      if (ev.type === 'cron') {
        this.cronStore.apply(ev.data.jobs)
        for (const alert of this.cronWatcher.ingest(ev.data.jobs)) this.d.notify?.(alert)
      }
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
    this.chat.dispose()
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
    this.chat.dispose()
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
    await this.teardown()
    this.everConnected = false
    this.setStatus({ ...IDLE })
  }

  async forget(): Promise<void> {
    await this.disconnect()
    this.cronWatcher.reset()
    this.cronStore.clear()
    this.feedCursors.clear()
    this.lastTarget = null
    this.d.store.forgetConnection()
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

  agentWriteFile(profile: string, kind: AgentFileKind, text: string, baseHash: string | null): ReturnType<AgentFileService['write']> {
    return this.agentFiles.write(profile, kind, text, baseHash)
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

  async cronOutput(profile: string, jobId: string): Promise<CronOutputResult> {
    const h = this.hermes
    if (!h || !this.d.manager.isConnected()) return { ok: false, reason: 'not-connected' }
    return readCronOutput(this.d.manager, h.home, this.cronStore, profile, jobId)
  }
}
