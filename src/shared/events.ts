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

const envelope = { ts: z.number(), profile: z.string().nullable() }

export const CollectorEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('metrics'), ...envelope, data: MetricsData }),
  z.object({ type: z.literal('agents'), ...envelope, data: AgentsData }),
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
