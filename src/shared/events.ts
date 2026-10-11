import { z } from 'zod'

export const AgentStatus = z.enum(['working', 'idle', 'offline', 'parked'])
export type AgentStatus = z.infer<typeof AgentStatus>

export const AgentInfo = z.object({
  profile: z.string(),
  displayName: z.string(),
  status: AgentStatus,
  platforms: z.array(z.string()),
  lastActivityTs: z.number().nullable(),
  configMtime: z.number().nullable(),
  hasSoul: z.boolean(),
  hasMemory: z.boolean(),
  hasUser: z.boolean()
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

const envelope = { ts: z.number(), profile: z.string().nullable() }

export const CollectorEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('metrics'), ...envelope, data: MetricsData }),
  z.object({ type: z.literal('agents'), ...envelope, data: AgentsData }),
  z.object({ type: z.literal('cron'), ...envelope, data: CronData }),
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
