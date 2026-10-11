import { z } from 'zod'
import type { BrowseResult, ChatSessions, CollectorEvent, FeedHistory, FeedMessageText, NoteText, SessionDetail, UploadsList, VaultCheck } from './events'
import type { SettingsMap } from './settings'

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

export type CronOutputResult =
  | { ok: true; text: string; truncated: boolean; name: string; mtime: number }
  | { ok: false; reason: 'no-output' | 'not-found' | 'unreadable' | 'not-connected' }

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
  | { kind: 'start'; mode: 'stream-json' | 'plain'; note?: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'ok' | 'error'; ms?: number }
  | { kind: 'result'; exitCode: number | null; durationMs?: number; inputTokens?: number; outputTokens?: number }
  | { kind: 'notice'; code: 'blocked'; message: string }
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

export interface OpenCronTarget {
  profile: string
  jobId: string
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
    output(profile: string, jobId: string): Promise<CronOutputResult>
  }
  feed: {
    message(profile: string, messageId: number, field: 'content' | 'reasoning' | 'tool_calls', index?: number): Promise<QueryResult<FeedMessageText>>
    history(before: Record<string, number>, limit: number): Promise<QueryResult<FeedHistory>>
    session(profile: string, sessionId: string): Promise<QueryResult<SessionDetail>>
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
  onEvent(cb: (e: CollectorEvent) => void): Unsub
  onChat(cb: (e: ChatEvent) => void): Unsub
  onUpload(cb: (p: UploadProgress) => void): Unsub
  onStatus(cb: (s: ConnStatus) => void): Unsub
  onStartup(cb: (p: StartupProgress) => void): Unsub
  onPreflight(cb: (p: PreflightResult) => void): Unsub
  onCapabilities(cb: (c: Capabilities) => void): Unsub
  onModels(cb: (m: AgentModels) => void): Unsub
  onOpenCron(cb: (t: OpenCronTarget) => void): Unsub
}
