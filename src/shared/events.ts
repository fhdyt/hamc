import { z } from 'zod'

export const AgentStatus = z.enum(['working', 'idle', 'offline', 'parked'])
export type AgentStatus = z.infer<typeof AgentStatus>

export const AgentStats = z.object({
  sessions: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative()
})
export type AgentStats = z.infer<typeof AgentStats>

export const AgentInfo = z.object({
  profile: z.string(),
  displayName: z.string(),
  status: AgentStatus,
  platforms: z.array(z.string()),
  lastActivityTs: z.number().nullable(),
  configMtime: z.number().nullable(),
  hasSoul: z.boolean(),
  hasMemory: z.boolean(),
  hasUser: z.boolean(),
  stats: AgentStats.nullable().optional()
})
export type AgentInfo = z.infer<typeof AgentInfo>

export const AgentsData = z.object({
  agents: z.array(AgentInfo),
  gateway: z.object({
    up: z.boolean(),
    heartbeatAgeS: z.number().nullable(),
    served: z.array(z.string())
  })
})
export type AgentsData = z.infer<typeof AgentsData>

const Bytes = z.number().nonnegative()

export const MetricsData = z.object({
  cpu: z.object({
    total: z.number(),
    cores: z.array(z.number()),
    load: z.tuple([z.number(), z.number(), z.number()]),
    uptimeS: z.number(),
    tempC: z.number().nullable()
  }),
  mem: z.object({
    total: Bytes,
    used: Bytes,
    cached: Bytes,
    available: Bytes,
    free: Bytes,
    swapTotal: Bytes,
    swapUsed: Bytes
  }),
  disks: z.array(z.object({ mount: z.string(), fs: z.string(), total: Bytes, used: Bytes })),
  io: z.object({ readBps: Bytes, writeBps: Bytes }),
  net: z.array(
    z.object({ name: z.string(), rxBps: Bytes, txBps: Bytes, rxTotal: Bytes, txTotal: Bytes })
  ),
  procs: z.array(
    z.object({
      pid: z.number().int(),
      user: z.string(),
      cpu: z.number(),
      mem: z.number(),
      rss: Bytes,
      cmd: z.string(),
      hermes: z.boolean()
    })
  ),
  tasks: z.number().int().nonnegative()
})
export type MetricsData = z.infer<typeof MetricsData>

export const ErrorData = z.object({
  code: z.string(),
  message: z.string(),
  profile: z.string().optional()
})
export type ErrorData = z.infer<typeof ErrorData>

export const CronState = z.enum(['scheduled', 'paused', 'running', 'completed'])
export type CronState = z.infer<typeof CronState>

export const CronJob = z.object({
  profile: z.string(),
  id: z.string(),
  name: z.string(),
  schedule: z.object({ kind: z.string(), expr: z.string().nullable(), display: z.string() }),
  state: CronState,
  enabled: z.boolean(),
  nextRunTs: z.number().nullable(),
  lastRunTs: z.number().nullable(),
  tzOffsetMin: z.number().int().nullable(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  lastDeliveryError: z.string().nullable(),
  failureStreak: z.number().int().nonnegative(),
  deliver: z.string(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  skills: z.array(z.string()),
  repeat: z.object({ times: z.number().int().nullable(), completed: z.number().int() }),
  prompt: z.string(),
  lastOutput: z.object({ rel: z.string(), mtime: z.number() }).nullable()
})
export type CronJob = z.infer<typeof CronJob>

export const CronData = z.object({
  jobs: z.array(CronJob),
  profiles: z.array(z.object({ profile: z.string(), ok: z.boolean(), error: z.string().nullable() }))
})
export type CronData = z.infer<typeof CronData>

export const FeedKind = z.enum(['user', 'thinking', 'tool', 'result', 'reply'])
export type FeedKind = z.infer<typeof FeedKind>

export const FeedItem = z.object({
  id: z.string(),
  profile: z.string(),
  messageId: z.number().int(),
  sessionId: z.string(),
  source: z.string().nullable(),
  parentSessionId: z.string().nullable(),
  ts: z.number(),
  kind: FeedKind,
  text: z.string(),
  truncated: z.boolean(),
  fullLen: z.number().int().nonnegative(),
  toolName: z.string().nullable()
})
export type FeedItem = z.infer<typeof FeedItem>

export const FeedData = z.object({
  items: z.array(FeedItem),
  cursors: z.record(z.string(), z.number().int()),
  history: z.boolean()
})
export type FeedData = z.infer<typeof FeedData>

export const FeedMessageText = z.object({ text: z.string(), truncated: z.boolean(), fullLen: z.number().int().nonnegative() })
export type FeedMessageText = z.infer<typeof FeedMessageText>

export const FeedHistory = z.object({
  items: z.array(FeedItem),
  oldest: z.record(z.string(), z.number().int().nullable()),
  exhausted: z.record(z.string(), z.boolean())
})
export type FeedHistory = z.infer<typeof FeedHistory>

export const SessionDetail = z.object({
  session: z.object({
    id: z.string(),
    source: z.string().nullable(),
    model: z.string().nullable(),
    parentSessionId: z.string().nullable(),
    startedAt: z.number().nullable(),
    endedAt: z.number().nullable(),
    title: z.string().nullable()
  }),
  children: z.array(z.object({ id: z.string(), source: z.string().nullable() })),
  items: z.array(FeedItem),
  more: z.boolean()
})
export type SessionDetail = z.infer<typeof SessionDetail>

export const SessionStatus = z.enum(['running', 'ended', 'failed', 'compressed'])
export type SessionStatus = z.infer<typeof SessionStatus>

const OptInt = z.number().int().nullable()

export const SessionRow = z.object({
  profile: z.string(),
  id: z.string(),
  title: z.string().nullable(),
  source: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  endReason: z.string().nullable(),
  messageCount: OptInt,
  toolCallCount: OptInt,
  inputTokens: OptInt,
  outputTokens: OptInt,
  cacheReadTokens: OptInt,
  cost: z.number().nullable(),
  costKind: z.enum(['actual', 'estimated']).nullable(),
  parentSessionId: z.string().nullable(),
  hasChildren: z.boolean(),
  pinned: z.boolean(),
  status: SessionStatus,
  /** Search only: the matching text with 0x02 and 0x03 around the matched words. */
  snippet: z.string().nullable()
})
export type SessionRow = z.infer<typeof SessionRow>

export const SessionsList = z.object({
  rows: z.array(SessionRow),
  sources: z.array(z.string()),
  errors: z.array(z.object({ profile: z.string(), code: z.string() })),
  more: z.boolean(),
  /** `title` when the search could not use the message index and only looked at titles. */
  fallback: z.enum(['title']).nullable()
})
export type SessionsList = z.infer<typeof SessionsList>

export const SessionTranscript = z.object({
  session: SessionRow,
  items: z.array(FeedItem),
  nextAfter: z.number().int().nullable(),
  chain: z.object({
    parent: z.object({ id: z.string(), title: z.string().nullable() }).nullable(),
    children: z.array(z.object({ id: z.string(), title: z.string().nullable(), source: z.string().nullable() }))
  }),
  total: OptInt
})
export type SessionTranscript = z.infer<typeof SessionTranscript>

export const BrainNote = z.object({
  id: z.string(),
  title: z.string(),
  mtime: z.number(),
  size: z.number(),
  tags: z.array(z.string()),
  aliases: z.array(z.string()),
  links: z.array(z.string()),
  ghosts: z.array(z.string()),
  attachments: z.array(z.string())
})
export type BrainNote = z.infer<typeof BrainNote>

export const BrainData = z.object({
  mode: z.enum(['snapshot', 'delta']),
  first: z.boolean(),
  done: z.boolean(),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  notes: z.array(BrainNote),
  removed: z.array(z.string())
})
export type BrainData = z.infer<typeof BrainData>

export const VaultCheck = z.object({
  path: z.string(),
  exists: z.boolean(),
  readable: z.boolean(),
  notes: z.number().int().nonnegative(),
  truncated: z.boolean()
})
export type VaultCheck = z.infer<typeof VaultCheck>

export const BrowseResult = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  dirs: z.array(z.object({ name: z.string(), notes: z.number().int().nonnegative() })),
  truncated: z.boolean()
})
export type BrowseResult = z.infer<typeof BrowseResult>

export const NoteText = z.object({ id: z.string(), text: z.string(), truncated: z.boolean(), mtime: z.number() })
export type NoteText = z.infer<typeof NoteText>

export const ChatSessions = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      startedAt: z.number().nullable(),
      title: z.string().nullable(),
      preview: z.string().nullable(),
      messages: z.number().int().nonnegative()
    })
  )
})
export type ChatSessions = z.infer<typeof ChatSessions>

export const UploadsList = z.object({
  dir: z.string(),
  exists: z.boolean(),
  files: z.array(z.object({ agent: z.string(), date: z.string(), name: z.string(), size: z.number().nonnegative(), mtime: z.number(), path: z.string() })),
  truncated: z.boolean()
})
export type UploadsList = z.infer<typeof UploadsList>

export const InteractionKind = z.enum(['kanban', 'message', 'room', 'delegate'])
export type InteractionKind = z.infer<typeof InteractionKind>

export const InteractionEdge = z.object({
  id: z.string(),
  kind: InteractionKind,
  from: z.string(),
  to: z.string(),
  count: z.number().int().nonnegative(),
  firstTs: z.number(),
  lastTs: z.number(),
  label: z.string().nullable(),
  status: z.string().nullable()
})
export type InteractionEdge = z.infer<typeof InteractionEdge>

export const InteractionRoom = z.object({ id: z.string(), name: z.string(), members: z.array(z.string()), lastTs: z.number() })
export type InteractionRoom = z.infer<typeof InteractionRoom>

export const InteractionSub = z.object({ id: z.string(), parent: z.string(), status: z.enum(['running', 'done']), lastTs: z.number(), title: z.string().nullable() })
export type InteractionSub = z.infer<typeof InteractionSub>

export const InteractionSource = z.object({ state: z.enum(['ok', 'absent', 'unreadable']), unresolved: z.number().int().nonnegative() })
export type InteractionSource = z.infer<typeof InteractionSource>

/** A snapshot of who interacts with whom in the last 7 days; the renderer applies kinds and range itself. */
export const InteractionsData = z.object({
  since: z.number(),
  edges: z.array(InteractionEdge),
  rooms: z.array(InteractionRoom),
  subagents: z.array(InteractionSub),
  sources: z.object({ kanban: InteractionSource, message: InteractionSource, room: InteractionSource, delegate: InteractionSource })
})
export type InteractionsData = z.infer<typeof InteractionsData>

export const InteractionDetail = z.object({
  text: z.string(),
  truncated: z.boolean(),
  fullLen: z.number().int().nonnegative(),
  title: z.string().nullable(),
  ts: z.number().nullable(),
  source: z.string(),
  sessionId: z.string().nullable(),
  profile: z.string().nullable()
})
export type InteractionDetail = z.infer<typeof InteractionDetail>

const envelope = { ts: z.number(), profile: z.string().nullable() }

export const CollectorEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('metrics'), ...envelope, data: MetricsData }),
  z.object({ type: z.literal('agents'), ...envelope, data: AgentsData }),
  z.object({ type: z.literal('cron'), ...envelope, data: CronData }),
  z.object({ type: z.literal('feed'), ...envelope, data: FeedData }),
  z.object({ type: z.literal('brain'), ...envelope, data: BrainData }),
  z.object({ type: z.literal('interactions'), ...envelope, data: InteractionsData }),
  z.object({ type: z.literal('error'), ...envelope, data: ErrorData })
])
export type CollectorEvent = z.infer<typeof CollectorEvent>

export type ParseResult = { ok: true; event: CollectorEvent } | { ok: false; error: string }

export function parseEventLine(line: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }
  const r = CollectorEvent.safeParse(raw)
  if (r.success) return { ok: true, event: r.data }
  return { ok: false, error: r.error.issues[0]?.message ?? 'invalid event' }
}
