/** The only log files the app reads; the collector accepts nothing else. */
export const LOG_FILES = ['agent.log', 'errors.log', 'gateway.log', 'tool_calls.log'] as const
export type LogFileName = (typeof LOG_FILES)[number]

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'UNKNOWN'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** DEBUG is off by default (F-LOG-2); a line with no recognizable level counts as UNKNOWN and stays visible. */
export const DEFAULT_LOG_LEVELS: LogLevel[] = ['INFO', 'WARNING', 'ERROR', 'CRITICAL', 'UNKNOWN']

export const LOG_RANGES = ['15m', '1h', '6h', '24h'] as const
export type LogRange = (typeof LOG_RANGES)[number]
export const LOG_RANGE_SECONDS: Record<LogRange, number> = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400 }

export interface LogsListArgs {
  /** Empty means every profile. */
  profiles: string[]
}

export interface LogsReadArgs {
  profile: string
  file: LogFileName
  /** Byte offset to continue from (Follow); left out for the last lines. */
  after?: number
  limit: number
}

export type GatewayAction = 'restart' | 'stop'

export type GatewayActionResult = { ok: true; output: string } | { ok: false; error: 'not-connected' | 'bad-input' | 'failed'; detail?: string }

/** The exact command the confirm dialog shows; the main process builds the real one from the action and the profile. */
export function gatewayCommandPreview(action: GatewayAction, profile: string): string {
  return `$ hermes ${profile === 'default' ? '' : `-p ${profile} `}gateway ${action}`
}

/** The raw answers of the two read-only approvals commands; the renderer parses them tolerantly. */
export type ApprovalsResult =
  | { ok: true; policy: string; policyError: string | null; suggest: string; suggestError: string | null }
  | { ok: false; error: 'not-connected' | 'bad-input' }
