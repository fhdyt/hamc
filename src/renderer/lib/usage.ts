import type { UsageRow } from '@shared/events'

export interface DayTotal {
  index: number
  /** Local midnight, epoch seconds. */
  ts: number
  total: number
  byAgent: Record<string, number>
  /** Part of the day's cost is an estimate. */
  estimated: boolean
}

/** One entry per requested day, in order; days without sessions are zero. */
export function buildDays(rows: readonly UsageRow[], dayStarts: readonly number[]): DayTotal[] {
  const days: DayTotal[] = dayStarts.map((ts, index) => ({ index, ts, total: 0, byAgent: {}, estimated: false }))
  for (const r of rows) {
    const d = days[r.day]
    if (!d) continue
    d.total += r.cost
    d.byAgent[r.profile] = (d.byAgent[r.profile] ?? 0) + r.cost
    if (r.estimatedCost > 0) d.estimated = true
  }
  return days
}

const pick = (rows: readonly UsageRow[], day: number | null): UsageRow[] => (day === null ? [...rows] : rows.filter((r) => r.day === day))

export interface AgentLine {
  profile: string
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cost: number
  estimated: boolean
  /** 0 to 1 of the total cost of the selection. */
  share: number
}

export function byAgent(rows: readonly UsageRow[], day: number | null): AgentLine[] {
  const map = new Map<string, AgentLine>()
  for (const r of pick(rows, day)) {
    const l = map.get(r.profile) ?? { profile: r.profile, sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cost: 0, estimated: false, share: 0 }
    l.sessions += r.sessions
    l.inputTokens += r.inputTokens
    l.outputTokens += r.outputTokens
    l.cacheReadTokens += r.cacheReadTokens
    l.cost += r.cost
    if (r.estimatedCost > 0) l.estimated = true
    map.set(r.profile, l)
  }
  const lines = [...map.values()]
  const total = lines.reduce((s, l) => s + l.cost, 0)
  for (const l of lines) l.share = total > 0 ? l.cost / total : 0
  return lines.sort((a, b) => b.cost - a.cost || (a.profile < b.profile ? -1 : 1))
}

export interface ModelLine {
  provider: string | null
  model: string | null
  sessions: number
  /** Null when no session of the group reported a count. */
  apiCalls: number | null
  cost: number
  estimated: boolean
}

export function byModel(rows: readonly UsageRow[], day: number | null): ModelLine[] {
  const map = new Map<string, ModelLine>()
  for (const r of pick(rows, day)) {
    const key = `${r.provider ?? ''}\u0000${r.model ?? ''}`
    const l = map.get(key) ?? { provider: r.provider, model: r.model, sessions: 0, apiCalls: null, cost: 0, estimated: false }
    l.sessions += r.sessions
    if (r.apiCalls !== null) l.apiCalls = (l.apiCalls ?? 0) + r.apiCalls
    l.cost += r.cost
    if (r.estimatedCost > 0) l.estimated = true
    map.set(key, l)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || ((a.model ?? '') < (b.model ?? '') ? -1 : 1))
}

/** Total of the range, the average per day, and the last day (today). */
export function summaryOf(days: readonly DayTotal[]): { total: number; average: number; today: number } {
  const total = days.reduce((s, d) => s + d.total, 0)
  return { total, average: days.length > 0 ? total / days.length : 0, today: days[days.length - 1]?.total ?? 0 }
}

/** A round top value and 4 to 6 evenly spaced ticks from 0, for the Y axis. */
export function niceTicks(max: number, count = 4): { max: number; ticks: number[] } {
  const top = Math.max(max, 0.01)
  const rough = top / count
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const frac = rough / pow
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10) * pow
  const n = Math.max(1, Math.ceil(top / step - 1e-9))
  const ticks = Array.from({ length: n + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6)
  return { max: ticks[ticks.length - 1]!, ticks }
}

/** Indexes of the days whose cost is strictly above the threshold. */
export function daysOver(days: readonly DayTotal[], threshold: number): number[] {
  return days.filter((d) => d.total > threshold).map((d) => d.index)
}

export function moneyLabel(n: number, estimated = false): string {
  const base = n > 0 && n < 0.005 ? '<$0.01' : `$${n.toFixed(2)}`
  return estimated ? `${base} est.` : base
}

/** Sessions with no usable cost figure; the screen says they are not counted. */
export function unknownCostSessions(rows: readonly UsageRow[]): number {
  return rows.reduce((s, r) => s + r.unknownCost, 0)
}
