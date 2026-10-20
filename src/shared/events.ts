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

export const GatewayPlatform = z.object({ name: z.string(), state: z.string().nullable(), errorCode: z.string().nullable() })
export type GatewayPlatform = z.infer<typeof GatewayPlatform>

/** From the profile's own gateway_state.json. Unknown fields are ignored by the collector. */
export const GatewayInfo = z.object({
  state: z.string().nullable(),
  pidAlive: z.boolean().nullable(),
  updatedAgeS: z.number().nullable(),
  exitReason: z.string().nullable(),
  restartRequested: z.boolean(),
  platforms: z.array(GatewayPlatform)
})
export type GatewayInfo = z.infer<typeof GatewayInfo>

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
  stats: AgentStats.nullable().optional(),
  gateway: GatewayInfo.nullable().optional(),
  /** ERROR and CRITICAL lines of errors.log in the last hour; null when it cannot be told. */
  errors1h: z.number().int().nonnegative().nullable().optional()
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

/** A failure incident of the Hermes cron ledger (`cron_incidents` in cron/executions.db). */
export const CronIncident = z.object({
  id: z.string(),
  /** detected, alerted (a failure ping reached the operator), resolved (a later run was good) or closed (acknowledged). */
  state: z.string(),
  failureType: z.string(),
  firstSeenTs: z.number().nullable(),
  lastSeenTs: z.number().nullable(),
  ackedTs: z.number().nullable(),
  closedTs: z.number().nullable(),
  error: z.string(),
  /** File name of the output of the failed run, when Hermes kept one. */
  output: z.string().nullable()
})
export type CronIncident = z.infer<typeof CronIncident>

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
  lastOutput: z.object({ rel: z.string(), mtime: z.number() }).nullable(),
  /** The newest attempt in the ledger is still claimed or running. */
  inflight: z.boolean().default(false),
  /** The newest open (detected or alerted) incident of this job. */
  incident: CronIncident.nullable().default(null)
})
export type CronJob = z.infer<typeof CronJob>

export const CronData = z.object({
  jobs: z.array(CronJob),
  profiles: z.array(z.object({ profile: z.string(), ok: z.boolean(), error: z.string().nullable() }))
})
export type CronData = z.infer<typeof CronData>

export const CronRun = z.object({
  id: z.string(),
  /** claimed, running, completed, failed or unknown (Hermes could not prove the outcome). */
  status: z.string(),
  source: z.string().nullable(),
  trigger: z.enum(['scheduled', 'manual']).nullable(),
  claimedTs: z.number().nullable(),
  startedTs: z.number().nullable(),
  finishedTs: z.number().nullable(),
  error: z.string().nullable(),
  delivery: z.string().nullable(),
  /** Name of the output file written by this run (from `outputs`). */
  output: z.string().nullable()
})
export type CronRun = z.infer<typeof CronRun>

export const CronRuns = z.object({
  ledger: z.enum(['ok', 'absent', 'unreadable']),
  runs: z.array(CronRun),
  incidents: z.array(CronIncident),
  outputs: z.array(z.object({ name: z.string(), mtime: z.number(), size: z.number() }))
})
export type CronRuns = z.infer<typeof CronRuns>

export const CronOutputFiles = z.object({
  files: z.array(
    z.union([
      z.object({ name: z.string(), text: z.string(), truncated: z.boolean(), mtime: z.number(), size: z.number() }),
      z.object({ name: z.string(), error: z.string() })
    ])
  )
})
export type CronOutputFiles = z.infer<typeof CronOutputFiles>

/** One changed memory file of one profile (M10b): sent by the collector when its content hash changes. */
export const MemoryFileEvent = z.object({
  profile: z.string(),
  file: z.enum(['soul', 'memory', 'user']),
  hash: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  size: z.number(),
  mtime: z.number(),
  /** Time of a `memory` tool result within two minutes of the change, from state.db. */
  agentTs: z.number().nullable(),
  agentSession: z.string().nullable()
})
export type MemoryFileEvent = z.infer<typeof MemoryFileEvent>

export const SkillOrigin = z.enum(['agent', 'hub', 'bundled'])
export type SkillOrigin = z.infer<typeof SkillOrigin>

/** One skill of one profile, from skills/ and .usage.json (M10a). */
export const Skill = z.object({
  profile: z.string(),
  /** Folder relative to skills/ (`.archive/<name>` for an archived skill); the key for `skill_read`. */
  path: z.string(),
  category: z.string(),
  dir: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().nullable(),
  author: z.string().nullable(),
  tags: z.array(z.string()),
  platforms: z.array(z.string()),
  requiresToolsets: z.array(z.string()),
  /** Names only; values are never read. */
  envNames: z.array(z.string()),
  origin: SkillOrigin,
  createdBy: z.string().nullable(),
  state: z.enum(['active', 'stale', 'archived']),
  pinned: z.boolean(),
  useCount: z.number().int(),
  viewCount: z.number().int(),
  patchCount: z.number().int(),
  createdAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  lastViewedAt: z.number().nullable(),
  lastPatchedAt: z.number().nullable(),
  archivedAt: z.number().nullable(),
  size: z.number(),
  mtime: z.number()
})
export type Skill = z.infer<typeof Skill>

export const SkillsList = z.object({
  skills: z.array(Skill),
  profiles: z.array(z.object({ profile: z.string(), ok: z.boolean(), error: z.string().nullable(), total: z.number().int(), truncated: z.boolean() }))
})
export type SkillsList = z.infer<typeof SkillsList>

export const SkillText = z.object({ path: z.string(), text: z.string(), truncated: z.boolean(), size: z.number(), mtime: z.number() })
export type SkillText = z.infer<typeof SkillText>

export const SkillLedgerEntry = z.object({
  id: z.string(),
  ts: z.number().nullable(),
  actor: z.string(),
  action: z.string(),
  skill: z.string(),
  note: z.string().nullable(),
  sessionId: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }))
})
export type SkillLedgerEntry = z.infer<typeof SkillLedgerEntry>

export const SkillsLedger = z.object({ profile: z.string(), entries: z.array(SkillLedgerEntry), exists: z.boolean(), truncated: z.boolean() })
export type SkillsLedger = z.infer<typeof SkillsLedger>

export const SkillBlobs = z.object({
  blobs: z.array(z.union([z.object({ sha: z.string(), text: z.string(), truncated: z.boolean() }), z.object({ sha: z.string(), error: z.string() })]))
})
export type SkillBlobs = z.infer<typeof SkillBlobs>

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

export const UsageRow = z.object({
  /** Index into the `dayStarts` of the request. */
  day: z.number().int().nonnegative(),
  profile: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  sessions: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  apiCalls: z.number().int().nonnegative().nullable(),
  cost: z.number(),
  /** The part of `cost` that is an estimate. */
  estimatedCost: z.number(),
  /** Sessions with no usable cost figure. */
  unknownCost: z.number().int().nonnegative()
})
export type UsageRow = z.infer<typeof UsageRow>

const QueryErrors = z.array(z.object({ profile: z.string(), code: z.string() }))

export const UsageSummary = z.object({ rows: z.array(UsageRow), truncated: z.boolean(), errors: QueryErrors })
export type UsageSummary = z.infer<typeof UsageSummary>

export const ToolFailure = z.object({ profile: z.string(), sessionId: z.string(), ts: z.number().nullable(), text: z.string() })
export type ToolFailure = z.infer<typeof ToolFailure>

export const ToolStat = z.object({
  name: z.string(),
  calls: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  avgMs: z.number().nullable(),
  maxMs: z.number().nullable(),
  lastTs: z.number().nullable(),
  byProfile: z.record(z.string(), z.number().int().nonnegative()),
  failures: z.array(ToolFailure)
})
export type ToolStat = z.infer<typeof ToolStat>

export const UsageTools = z.object({ tools: z.array(ToolStat), scanned: z.number().int().nonnegative(), truncated: z.boolean(), errors: QueryErrors })
export type UsageTools = z.infer<typeof UsageTools>

/** What the main process knows about today's cost against the daily alert. `total` is null until the first successful check. */
export const CostAlertState = z.object({
  enabled: z.boolean(),
  day: z.string(),
  total: z.number().nullable(),
  threshold: z.number(),
  over: z.boolean(),
  checkedAt: z.number()
})
export type CostAlertState = z.infer<typeof CostAlertState>

export const LogFileInfo = z.object({ profile: z.string(), name: z.string(), size: z.number().int().nonnegative(), mtime: z.number().nullable() })
export type LogFileInfo = z.infer<typeof LogFileInfo>

export const LogsList = z.object({ files: z.array(LogFileInfo), errors: z.array(z.object({ profile: z.string(), code: z.string() })) })
export type LogsList = z.infer<typeof LogsList>

export const LogsRead = z.object({
  lines: z.array(z.string()),
  /** Where the next read continues (the end of the last whole line). */
  offset: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  mtime: z.number().nullable(),
  /** Where the first returned line begins. */
  startOffset: z.number().int().nonnegative(),
  more: z.boolean(),
  /** The file is shorter than the offset asked for: it was rotated, and these are its last lines. */
  reset: z.boolean(),
  /** More than the cap was new, so only the newest part is returned. */
  skipped: z.boolean()
})
export type LogsRead = z.infer<typeof LogsRead>

export const KanbanBoard = z.object({
  /** `default` for the kanban.db in the Hermes home, else the folder name under kanban/boards. */
  slug: z.string(),
  path: z.string(),
  tasks: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  readable: z.boolean()
})
export type KanbanBoard = z.infer<typeof KanbanBoard>

export const KanbanBoards = z.object({ boards: z.array(KanbanBoard), errors: z.array(z.object({ slug: z.string(), code: z.string() })) })
export type KanbanBoards = z.infer<typeof KanbanBoards>

export const KanbanTask = z.object({
  id: z.string(),
  title: z.string().nullable(),
  assignee: z.string().nullable(),
  createdBy: z.string().nullable(),
  status: z.string(),
  priority: z.number().int(),
  createdAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  comments: z.number().int().nonnegative(),
  parents: z.number().int().nonnegative(),
  children: z.number().int().nonnegative(),
  blockKind: z.string().nullable(),
  failures: z.number().int().nonnegative(),
  failed: z.boolean()
})
export type KanbanTask = z.infer<typeof KanbanTask>

export const KanbanTasks = z.object({ board: z.string(), tasks: z.array(KanbanTask), archived: z.number().int().nonnegative(), truncated: z.boolean() })
export type KanbanTasks = z.infer<typeof KanbanTasks>

const TaskRef = z.object({ id: z.string(), title: z.string().nullable(), status: z.string() })

export const KanbanTaskDetail = z.object({
  task: KanbanTask.extend({
    body: z.string().nullable(),
    result: z.string().nullable(),
    lastFailureError: z.string().nullable(),
    skills: z.string().nullable(),
    modelOverride: z.string().nullable(),
    providerOverride: z.string().nullable(),
    sessionId: z.string().nullable()
  }),
  comments: z.array(z.object({ id: z.number().int(), author: z.string().nullable(), body: z.string(), createdAt: z.number().nullable() })),
  runs: z.array(
    z.object({
      id: z.number().int(),
      profile: z.string().nullable(),
      stepKey: z.string().nullable(),
      status: z.string().nullable(),
      startedAt: z.number().nullable(),
      endedAt: z.number().nullable(),
      outcome: z.string().nullable(),
      summary: z.string().nullable(),
      error: z.string().nullable()
    })
  ),
  parents: z.array(TaskRef),
  children: z.array(TaskRef),
  events: z.array(z.object({ id: z.number().int(), runId: OptInt, kind: z.string().nullable(), payload: z.string().nullable(), createdAt: z.number().nullable() })),
  attachments: z.array(z.object({ id: z.number().int(), filename: z.string().nullable(), size: OptInt, uploadedBy: z.string().nullable(), createdAt: z.number().nullable() }))
})
export type KanbanTaskDetail = z.infer<typeof KanbanTaskDetail>

export const BrainNote = z.object({
  id: z.string(),
  title: z.string(),
  mtime: z.number(),
  size: z.number(),
  /** When the file was created (statx), epoch seconds; null where the server's file system does not keep it. */
  born: z.number().nullable().optional(),
  /** The day the note says it was written (`YYYY-MM-DD` from the frontmatter `created`/`date` or a dated file name). */
  dated: z.string().nullable().optional(),
  datedFrom: z.enum(['frontmatter', 'name']).nullable().optional(),
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

/** F-BRAIN-10: the keys of `<vault>/.obsidian/graph.json` the collector lets through. */
export const ObsidianGraph = z.object({
  colorGroups: z.array(z.object({ query: z.string().max(500), color: z.object({ a: z.number(), rgb: z.number().int().min(0).max(0xffffff) }) })).max(64).optional(),
  showTags: z.boolean().optional(),
  showAttachments: z.boolean().optional(),
  hideUnresolved: z.boolean().optional(),
  showOrphans: z.boolean().optional(),
  centerStrength: z.number().optional(),
  repelStrength: z.number().optional(),
  linkStrength: z.number().optional(),
  linkDistance: z.number().optional(),
  nodeSizeMultiplier: z.number().optional(),
  lineSizeMultiplier: z.number().optional(),
  textFadeMultiplier: z.number().optional(),
  search: z.string().max(500).optional()
})
export type ObsidianGraph = z.infer<typeof ObsidianGraph>
export const ObsidianGraphResult = z.union([
  z.object({ found: z.literal(false) }),
  z.object({ found: z.literal(true), mtime: z.number(), graph: ObsidianGraph })
])
export type ObsidianGraphResult = z.infer<typeof ObsidianGraphResult>

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
  z.object({ type: z.literal('memory'), ...envelope, data: MemoryFileEvent }),
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
