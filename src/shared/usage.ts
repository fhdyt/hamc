import type { Range } from './sessions'

export interface UsageSummaryArgs {
  /** Empty means every profile. */
  profiles: string[]
  /** Local midnights in epoch seconds, ascending. */
  dayStarts: number[]
  /** The midnight after the last day. */
  endTs: number
}

export interface UsageToolsArgs {
  profiles: string[]
  sinceTs: number
  endTs: number
}

export const COST_MIN = 0.01
export const COST_MAX = 100000
export const COST_DEFAULT = 10

export const validCostThreshold = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= COST_MIN && n <= COST_MAX

/** Usage shows 7, 14 or 30 days. `today` counts as 7 and `all` as 30; the setting itself is never rewritten. */
export function usageDays(range: Range): 7 | 14 | 30 {
  return range === '14d' ? 14 : range === '30d' || range === 'all' ? 30 : 7
}

/** Local midnights of the last `days` days (today last) and the midnight after today. Each one is built from a calendar date, so DST cannot shift it. */
export function dayStartsFor(days: number, now: number): { dayStarts: number[]; endTs: number } {
  const t = new Date(now * 1000)
  const at = (offset: number): number => new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset).getTime() / 1000
  const dayStarts: number[] = []
  for (let i = days - 1; i >= 0; i--) dayStarts.push(at(-i))
  return { dayStarts, endTs: at(1) }
}

const p2 = (n: number): string => String(n).padStart(2, '0')

export function localDayKey(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
