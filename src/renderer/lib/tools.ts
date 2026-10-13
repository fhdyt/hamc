import type { ToolStat } from '@shared/events'

export type ToolSort = 'calls' | 'errors' | 'time'

/** A new array; ties keep the busiest tool first and then the name. */
export function sortTools(tools: readonly ToolStat[], by: ToolSort): ToolStat[] {
  const key = (t: ToolStat): number => (by === 'calls' ? t.calls : by === 'errors' ? t.errors : (t.avgMs ?? -1))
  return [...tools].sort((a, b) => key(b) - key(a) || b.calls - a.calls || (a.name < b.name ? -1 : 1))
}

export const failureRate = (t: Pick<ToolStat, 'calls' | 'errors'>): number => (t.calls > 0 ? t.errors / t.calls : 0)

/** 0 to 100, for the proportion bar. */
export const shareOf = (t: Pick<ToolStat, 'calls'>, max: number): number => (max > 0 ? Math.round((t.calls / max) * 100) : 0)

export function durationLabel(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
