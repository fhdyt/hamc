import type { SessionRow, SessionStatus } from '@shared/events'
import { sinceFor, type Range, type SessionFilterArgs } from '@shared/sessions'

export interface SessionQuery {
  /** `all` or a profile name. Shared with the other screens through the `filters.agent` setting. */
  agent: string
  range: Range
  /** `all` or a `source` value. */
  source: string
  /** Search text; empty means the plain list. */
  q: string
}

export const DEFAULT_QUERY: SessionQuery = { agent: 'all', range: '7d', source: 'all', q: '' }

export const rowKey = (r: Pick<SessionRow, 'profile' | 'id'>): string => `${r.profile}:${r.id}`

/** Query arguments for the collector. An agent that no longer exists counts as "all". */
export function toArgs(q: SessionQuery, known: readonly string[], now: number): SessionFilterArgs {
  const args: SessionFilterArgs = { profiles: q.agent !== 'all' && known.includes(q.agent) ? [q.agent] : [] }
  if (q.source !== 'all') args.source = q.source
  const since = sinceFor(q.range, now)
  if (since !== undefined) args.sinceTs = since
  return args
}

/** Newest first, rows without a start time last, ties by id descending: the order the collector uses. */
export function sortRows(rows: SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) => {
    if ((a.startedAt === null) !== (b.startedAt === null)) return a.startedAt === null ? 1 : -1
    if (a.startedAt !== b.startedAt) return (b.startedAt ?? 0) - (a.startedAt ?? 0)
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/**
 * A refreshed first page replaces the head of the list; rows loaded further down (older than everything on the fresh
 * page) stay. A row of the head range that is missing from the fresh page is gone.
 */
export function mergeFirstPage(current: SessionRow[], fresh: SessionRow[]): SessionRow[] {
  if (fresh.length === 0) return current
  const oldest = fresh.reduce((m, r) => Math.min(m, r.startedAt ?? -Infinity), Infinity)
  const keys = new Set(fresh.map(rowKey))
  const tail = current.filter((r) => !keys.has(rowKey(r)) && (r.startedAt ?? -Infinity) < oldest)
  return sortRows([...fresh, ...tail])
}

export function patchRow(rows: SessionRow[], key: string, patch: Partial<SessionRow>): SessionRow[] {
  return rows.map((r) => (rowKey(r) === key ? { ...r, ...patch } : r))
}

export const statusLabel = (s: SessionStatus): string => s

export function costLabel(r: Pick<SessionRow, 'cost' | 'costKind'>): string {
  if (r.cost === null) return '—'
  return `$${r.cost.toFixed(2)}${r.costKind === 'estimated' ? ' est.' : ''}`
}

const p2 = (n: number): string => String(n).padStart(2, '0')

export function durationLabel(r: Pick<SessionRow, 'status' | 'startedAt' | 'endedAt'>): string {
  if (r.status === 'running') return 'running'
  if (r.startedAt === null || r.endedAt === null) return '—'
  const s = Math.max(0, Math.round(r.endedAt - r.startedAt))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${p2(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${p2(Math.floor((s % 3600) / 60))}m`
}

export interface Part {
  text: string
  hit: boolean
}

/** The collector wraps matched words in 0x02 and 0x03. Returns the pieces so React can draw `<mark>` without any HTML. */
export function splitHighlight(snippet: string): Part[] {
  const parts: Part[] = []
  let buf = ''
  let hit = false
  const flush = (): void => {
    if (buf) parts.push({ text: buf, hit })
    buf = ''
  }
  for (const ch of snippet) {
    if (ch === '\u0002') {
      flush()
      hit = true
    } else if (ch === '\u0003') {
      flush()
      hit = false
    } else buf += ch
  }
  flush()
  return parts
}
