import { z } from 'zod'
import type { AgentFileKind, FetchModelsResult, FileReadResult, FileWriteResult, ModelReadResult, ModelSaveRequest, RestartResult, SaveModelResult, TestModelResult } from './agentCfg'
import type { BrowseResult, ChatSessions, CollectorEvent, FeedHistory, FeedMessageText, InteractionDetail, InteractionKind, NoteText, SessionDetail, SessionsList, SessionTranscript, UploadsList, VaultCheck } from './events'
import type { KanbanTaskArgs, KanbanTasksArgs } from './kanban'
import type { CronActionRequest, CronActionResult } from './cron'
import type { SkillActionRequest, SkillActionResult, SkillTextResult } from './skills'
import type { MemoryVersion, MemoryVersionText } from './memory'
import type { BackupRequest, BackupResult, NewProfileRequest, OpsApply, OpsText, ToolChange } from './agentOps'
import type { CostAlertState, CronOutputFiles, CronRuns, SkillBlobs, SkillsLedger, SkillsList, SkillText, KanbanBoards, KanbanTaskDetail, KanbanTasks, LogsList, LogsRead, UsageSummary, UsageTools } from './events'
import type { ApprovalsResult, GatewayAction, GatewayActionResult, LogsListArgs, LogsReadArgs } from './logs'
import type { UsageSummaryArgs, UsageToolsArgs } from './usage'
import type { ExportExt, ExportResult, SessionAction, SessionActionResult, SessionsListArgs, SessionsSearchArgs, TranscriptArgs } from './sessions'
import type { SettingsMap } from './settings'
import type { Notice, NoticeTarget } from './notify'
import type { UpdateState } from './update'
import type { AgentLook, AgentLooks } from './looks'
import type { TermData, TermExit, TermOpenResult, TermSize, TermOpenRequest, TermInfo } from './terminal'

export { IPC } from './channels'

export const ConnectRequestSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(64),
  password: z.string().max(1024).optional(),
  remember: z.boolean(),
  useSaved: z.boolean().optional()
})
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>

export const HostKeyChallengeSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  algo: z.string(),
  fingerprint: z.string(),
  changed: z.boolean(),
  previous: z.string().optional()
})
export type HostKeyChallenge = z.infer<typeof HostKeyChallengeSchema>

export type ConnectErrorKind =
  | 'unreachable'
  | 'auth'
  | 'timeout'
  | 'hermes-missing'
  | 'hostkey-unverified'
  | 'hostkey-changed'
  | 'unknown'

export interface PreflightItem {
  id: string
  label: string
  state: 'ok' | 'warn' | 'fail' | 'info'
  result: string
  hint?: string
}

export interface PreflightResult {
  items: PreflightItem[]
  hermesHome: string | null
  hermesPath: string | null
  pythonPath: string | null
  version: string | null
  profileCount: number
  canStart: boolean
}

export type ConnectResult =
  | { ok: true; preflight: PreflightResult }
  | { ok: false; kind: ConnectErrorKind; message: string; hostKey?: HostKeyChallenge; preflight?: PreflightResult }

export interface SavedConnection {
  id: number
  name: string
  host: string
  port: number
  username: string
  remember: boolean
  hasPassword: boolean
  lastConnectedAt: number | null
  fingerprint: string | null
}

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface ConnStatus {
  state: ConnState
  latencyMs: number | null
  hermesVersion: string | null
  attempt: number
  nextRetryInS: number | null
  error: string | null
}

export type StartupStepId = 'credentials' | 'handshake' | 'hermes' | 'statedb' | 'collector'

export interface StartupStep {
  id: StartupStepId
  label: string
  detail: string
  state: 'pending' | 'running' | 'done' | 'failed'
}

export interface StartupProgress {
  steps: StartupStep[]
}

export interface Capabilities {
  version: string | null
  supported: Record<string, boolean>
}

export type AgentModels = Record<string, { provider: string | null; model: string | null } | null>

export interface AppInfo {
  version: string
  electron: string
  platform: string
}

/** What the renderer may ask about one edge or node of the agent graph; the main process checks it again. */
export type InteractionDetailArgs =
  | { kind: 'message'; from: string; to: string }
  | { kind: Exclude<InteractionKind, 'message'>; id: string }

export type QueryError =
  | 'bad_args'
  | 'not_found'
  | 'unsupported_schema'
  | 'db_unreadable'
  | 'unreadable'
  | 'unknown_command'
  | 'timeout'
  | 'not-connected'
  | 'invalid-response'

export type QueryResult<T> = { ok: true; data: T } | { ok: false; error: QueryError; detail?: string }

/** One thing that happens during a chat turn, as the main process sees it on the server. */
export type ChatEvent = { turn: string; profile: string } & (
  | { kind: 'start'; mode: 'stream-json' | 'plain' | 'acp' | 'gateway'; note?: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'ok' | 'error'; ms?: number }
  | { kind: 'result'; exitCode: number | null; durationMs?: number; inputTokens?: number; outputTokens?: number }
  | { kind: 'notice'; code: 'blocked'; message: string }
  /** Hermes asks before it runs something (ACP mode). Answered with `chat.approve`. */
  | { kind: 'approval'; id: string; title: string; detail?: string; options: { id: string; name: string; kind: 'allow' | 'deny' }[] }
  | { kind: 'approval-done'; id: string; outcome: 'allowed' | 'denied' | 'cancelled'; choice?: string }
  | { kind: 'error'; message: string }
  | { kind: 'end'; exitCode: number | null; stopped: boolean }
)

export type ChatSendError = 'not-connected' | 'busy' | 'empty' | 'too-long' | 'bad-profile' | 'hermes-missing' | 'upload-failed' | 'attachment-missing' | 'failed-to-start'

export type ChatSendResult = { ok: true; turn: string } | { ok: false; error: ChatSendError; detail?: string }

/** A local file the user chose to send with a message. The path stays in the main process. */
export interface Attachment {
  id: string
  name: string
  size: number
  mime: string
  /** A small data: URL for images. */
  thumb?: string
  /** Why the file cannot be sent (too large, unreadable). */
  problem?: string
}

export interface UploadProgress {
  id: string
  state: 'uploading' | 'done' | 'error' | 'cancelled'
  sent: number
  total: number
  remotePath?: string
  error?: string
}

type Unsub = () => void

export interface MissionApi {
  connection: {
    connect(req: ConnectRequest): Promise<ConnectResult>
    trustHostKey(c: HostKeyChallenge): Promise<void>
    disconnect(): Promise<void>
    forget(): Promise<void>
    saved(): Promise<SavedConnection | null>
    secretStatus(): Promise<{ canRemember: boolean; reason: string | null }>
  }
  settings: {
    all(): Promise<SettingsMap>
    set<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void>
    /** Puts every setting back to its default (not the window size, not the connection) and returns the new values. */
    reset(): Promise<SettingsMap>
  }
  agents: {
    getPins(): Promise<{ pins: string[]; initialized: boolean }>
    setPins(pins: string[]): Promise<void>
  }
  app: {
    setZoom(factor: number): Promise<void>
    info(): Promise<AppInfo>
  }
  cron: {
    /** One write through `hermes cron` after the user confirmed it; a fresh `cron` event follows. */
    action(req: CronActionRequest): Promise<CronActionResult>
    /** The newest attempts of a job from the Hermes run ledger, its output files and its incidents. */
    runs(args: { profile: string; jobId: string; limit: number }): Promise<QueryResult<CronRuns>>
    /** One or two output files of a job, by the names `runs` listed. */
    output(args: { profile: string; jobId: string; names: string[] }): Promise<QueryResult<CronOutputFiles>>
  }
  ops: {
    mcpList(profile: string): Promise<OpsText>
    /** `hermes mcp test <name>`: starts the server once, after the user confirmed. */
    mcpTest(profile: string, name: string): Promise<OpsText>
    fallbackList(profile: string): Promise<OpsText>
    /** `hermes tools list --platform <p>` for each platform. */
    toolsList(profile: string, platforms: string[]): Promise<Record<string, OpsText>>
    toolsApply(profile: string, changes: ToolChange[]): Promise<OpsApply>
    profileCreate(req: NewProfileRequest): Promise<OpsText>
    /** SFTP download of one profile into a zip the user saves locally (F-CFG-23). */
    backup(req: BackupRequest): Promise<BackupResult>
  }
  looks: {
    /** Local display names and photos of the agents of the saved connection (F-SHELL-6). */
    get(): Promise<AgentLooks>
    /** null goes back to the name Hermes reports. Answers the new look, or null without a saved connection. */
    setName(profile: string, name: string | null): Promise<AgentLook | null>
    /** A cropped picture as a data: URL (main turns it into a 96×96 PNG), or null to remove it. */
    setPhoto(profile: string, photo: string | null): Promise<AgentLook | null>
  }
  update: {
    /** Null only before the main process set the service up. */
    get(): Promise<UpdateState | null>
    /** Check for updates now (the button). */
    check(): Promise<UpdateState | null>
    /** Restart into the downloaded version; false when none is ready. */
    install(): Promise<boolean>
  }
  notify: {
    /** Shows one OS notification now (Settings → Notifications). */
    test(): Promise<{ shown: boolean; reason?: string }>
    /** A chat reply finished while that agent was not on screen. */
    chat(profile: string, title: string, body: string): Promise<void>
  }
  terminal: {
    /** Starts a shell: the system shell of this computer, or a shell on the server (system ssh or built-in). */
    open(req: TermOpenRequest): Promise<TermOpenResult>
    /** The local shell and ssh this computer has. */
    info(): Promise<TermInfo>
    /** What the user typed or pasted; false when that shell is gone. Never logged. */
    write(id: string, data: string): Promise<boolean>
    resize(id: string, size: TermSize): Promise<void>
    close(id: string): Promise<void>
  }
  memory: {
    /** Local versions of one memory file, newest first (F-MEMT-1). */
    versions(profile: string, file: AgentFileKind): Promise<MemoryVersion[]>
    version(id: number): Promise<MemoryVersionText>
    /** Deletes every local version of the current connection; answers how many. */
    clear(): Promise<number>
  }
  skills: {
    list(args: { profiles: string[] }): Promise<QueryResult<SkillsList>>
    read(args: { profile: string; path: string }): Promise<QueryResult<SkillText>>
    ledger(args: { profile: string; limit: number }): Promise<QueryResult<SkillsLedger>>
    blobs(args: { profile: string; shas: string[] }): Promise<QueryResult<SkillBlobs>>
    /** One write through `hermes curator|skills` after the user confirmed it. */
    action(req: SkillActionRequest): Promise<SkillActionResult>
    /** `hermes skills inspect <id>` (read-only). */
    inspect(profile: string, id: string): Promise<SkillTextResult>
    /** `hermes curator status` (read-only). */
    curatorStatus(profile: string): Promise<SkillTextResult>
  }
  interactions: {
    detail(args: InteractionDetailArgs): Promise<QueryResult<InteractionDetail>>
  }
  feed: {
    message(profile: string, messageId: number, field: 'content' | 'reasoning' | 'tool_calls', index?: number): Promise<QueryResult<FeedMessageText>>
    history(before: Record<string, number>, limit: number): Promise<QueryResult<FeedHistory>>
    session(profile: string, sessionId: string): Promise<QueryResult<SessionDetail>>
  }
  sessions: {
    list(args: SessionsListArgs): Promise<QueryResult<SessionsList>>
    search(args: SessionsSearchArgs): Promise<QueryResult<SessionsList>>
    transcript(args: TranscriptArgs): Promise<QueryResult<SessionTranscript>>
    action(req: { action: SessionAction; profile: string; sessionId: string; title?: string }): Promise<SessionActionResult>
    export(req: { name: string; ext: ExportExt; content: string }): Promise<ExportResult>
  }
  usage: {
    summary(args: UsageSummaryArgs): Promise<QueryResult<UsageSummary>>
    tools(args: UsageToolsArgs): Promise<QueryResult<UsageTools>>
  }
  logs: {
    list(args: LogsListArgs): Promise<QueryResult<LogsList>>
    read(args: LogsReadArgs): Promise<QueryResult<LogsRead>>
  }
  kanban: {
    boards(): Promise<QueryResult<KanbanBoards>>
    tasks(args: KanbanTasksArgs): Promise<QueryResult<KanbanTasks>>
    task(args: KanbanTaskArgs): Promise<QueryResult<KanbanTaskDetail>>
  }
  gateway: {
    action(req: { action: GatewayAction; profile: string }): Promise<GatewayActionResult>
  }
  approvals: {
    read(profile: string): Promise<ApprovalsResult>
  }
  alerts: {
    /** Checks the daily cost now (after a settings change). */
    recheck(): Promise<void>
  }
  brain: {
    get(): Promise<{ vault: string | null }>
    setVault(path: string | null): Promise<void>
    validate(path: string): Promise<QueryResult<VaultCheck>>
    browse(path: string): Promise<QueryResult<BrowseResult>>
    note(id: string): Promise<QueryResult<NoteText>>
  }
  chat: {
    send(req: { profile: string; text: string; attachmentIds: string[] }): Promise<ChatSendResult>
    stop(turn: string): Promise<void>
    /** Answers an approval request of a running turn; `option` null cancels it. Resolves false when it is no longer pending. */
    approve(req: { turn: string; approval: string; option: string | null }): Promise<boolean>
    getSession(profile: string): Promise<string | null>
    setSession(profile: string, sessionId: string | null): Promise<void>
    sessions(profile: string): Promise<QueryResult<ChatSessions>>
    /** Opens the native file picker. */
    pick(): Promise<Attachment[]>
    /** Registers files that were dropped on the window (their paths are read in the preload). */
    attach(files: File[]): Promise<Attachment[]>
    detach(id: string): Promise<void>
    /** The agent's `terminal.backend`, or null when it cannot be read. */
    backend(profile: string): Promise<string | null>
  }
  uploads: {
    list(): Promise<QueryResult<UploadsList>>
    remove(path: string): Promise<{ ok: true } | { ok: false; error: string }>
    cancel(id: string): Promise<void>
  }
  agentCfg: {
    /** SOUL.md, MEMORY.md or USER.md of a profile, with the hash the editor must send back when it saves. */
    readFile(profile: string, kind: AgentFileKind): Promise<FileReadResult>
    /** Writes only when the file on the server still has `baseHash` (null: it did not exist). */
    writeFile(req: { profile: string; kind: AgentFileKind; text: string; baseHash: string | null }): Promise<FileWriteResult>
    readModel(profile: string): Promise<ModelReadResult>
    fetchModels(req: { baseUrl: string; apiKey?: string }): Promise<FetchModelsResult>
    saveModel(req: ModelSaveRequest): Promise<SaveModelResult>
    testModel(profile: string): Promise<TestModelResult>
    /** True when an API key would have to travel as a command argument. */
    keyAsArgument(): Promise<boolean>
    restartGateway(profile: string): Promise<RestartResult>
  }
  onEvent(cb: (e: CollectorEvent) => void): Unsub
  onChat(cb: (e: ChatEvent) => void): Unsub
  onUpload(cb: (p: UploadProgress) => void): Unsub
  onStatus(cb: (s: ConnStatus) => void): Unsub
  onStartup(cb: (p: StartupProgress) => void): Unsub
  onPreflight(cb: (p: PreflightResult) => void): Unsub
  onCapabilities(cb: (c: Capabilities) => void): Unsub
  onModels(cb: (m: AgentModels) => void): Unsub
  onCostAlert(cb: (s: CostAlertState) => void): () => void
  /** A memory file got a new local version. */
  onMemory(cb: (e: { profile: string; file: AgentFileKind }) => void): Unsub
  onUpdate(cb: (s: UpdateState) => void): Unsub
  /** A notification for the bell (and a toast when the window is in front). */
  onNotice(cb: (n: Notice) => void): Unsub
  /** An OS notification was clicked: open what it is about. */
  onNoticeOpen(cb: (t: NoticeTarget) => void): Unsub
  onTermData(cb: (e: TermData) => void): Unsub
  onTermExit(cb: (e: TermExit) => void): Unsub
}
