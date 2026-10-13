import type { LogLevel } from '@shared/logs'
import type { LogLine } from './logParse'

export interface LogFilter {
  levels: readonly LogLevel[]
  /** `all` or a component name. */
  component: string
  /** Seconds back from now, or null for everything loaded. */
  rangeS: number | null
  query: string
}

const QUARTER = 900
const MAX_OFFSET = 14 * 3600

/**
 * The time zone of the server's wall clock, from the file time and the last line that carries a wall-clock time. The
 * file was last written at about that line, so the difference is the offset, rounded to a quarter of an hour.
 */
export function serverOffset(lines: readonly LogLine[], mtime: number | null): number {
  if (mtime === null) return 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!
    if (l.naive !== null && l.tz === null) return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round((l.naive - mtime) / QUARTER) * QUARTER))
  }
  return 0
}

/** The moment of a line in epoch seconds, or null when it has none. */
export function lineEpoch(l: LogLine, offset: number): number | null {
  if (l.naive === null) return null
  return l.naive - (l.tz !== null ? l.tz : offset)
}

/** The lines that pass the level, component, range and search. Lines without a time pass the range. */
export function filterLines(lines: readonly LogLine[], f: LogFilter, nowEpoch: number, offset: number): LogLine[] {
  const q = f.query.trim().toLowerCase()
  const cutoff = f.rangeS === null ? null : nowEpoch - f.rangeS
  return lines.filter((l) => {
    if (!f.levels.includes(l.level)) return false
    if (f.component !== 'all' && l.component !== f.component) return false
    if (cutoff !== null) {
      const t = lineEpoch(l, offset)
      if (t !== null && t <= cutoff) return false
    }
    return q === '' || l.raw.toLowerCase().includes(q)
  })
}

export function componentsOf(lines: readonly LogLine[]): string[] {
  return [...new Set(lines.map((l) => l.component).filter((c): c is string => c !== null))].sort()
}

export interface Match {
  text: string
  hit: boolean
}

/** The text cut around the matches of a query (case-insensitive), so React can draw `<mark>` without any HTML. */
export function splitMatches(text: string, query: string): Match[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const out: Match[] = []
  let at = 0
  for (;;) {
    const i = lower.indexOf(q, at)
    if (i < 0) break
    if (i > at) out.push({ text: text.slice(at, i), hit: false })
    out.push({ text: text.slice(i, i + q.length), hit: true })
    at = i + q.length
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out.length > 0 ? out : [{ text, hit: false }]
}
