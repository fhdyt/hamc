import { z } from 'zod'
import type { CollectorEvent, FeedHistory, FeedMessageText, SessionDetail } from './events'
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
  | 'unknown_command'
  | 'timeout'
  | 'not-connected'
  | 'invalid-response'

export type QueryResult<T> = { ok: true; data: T } | { ok: false; error: QueryError }

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
  onEvent(cb: (e: CollectorEvent) => void): Unsub
  onStatus(cb: (s: ConnStatus) => void): Unsub
  onStartup(cb: (p: StartupProgress) => void): Unsub
  onPreflight(cb: (p: PreflightResult) => void): Unsub
  onCapabilities(cb: (c: Capabilities) => void): Unsub
  onModels(cb: (m: AgentModels) => void): Unsub
  onOpenCron(cb: (t: OpenCronTarget) => void): Unsub
}
