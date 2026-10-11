import type { FeedItem, FeedKind } from '@shared/events'

export const FEED_CAP = 5000

export const KINDS: readonly FeedKind[] = ['user', 'reply', 'thinking', 'tool', 'result']

export const KIND_LABEL: Record<FeedKind, string> = {
  user: 'USER',
  reply: 'REPLY',
  thinking: 'THINKING',
  tool: 'TOOL CALL',
  result: 'TOOL RESULT'
}

export const KIND_NAME: Record<FeedKind, string> = {
  user: 'User',
  reply: 'Reply',
  thinking: 'Thinking',
  tool: 'Tool call',
  result: 'Tool result'
}

export const KIND_COLOR: Record<FeedKind, string> = {
  user: '#F1FA8C',
  reply: '#50FA7B',
  thinking: '#8BE9FD',
  tool: '#FFB86C',
  result: '#A9B2D3'
}

export interface FeedFilter {
  /** Profiles that are switched off. Empty means every agent is shown. */
  hiddenAgents: readonly string[]
  /** Kinds that are switched off. */
  hiddenKinds: readonly FeedKind[]
  /** Session sources that are switched off (telegram, cron, subagent, …). */
  hiddenSources: readonly string[]
  query: string
}

export const DEFAULT_FILTER: FeedFilter = { hiddenAgents: [], hiddenKinds: [], hiddenSources: [], query: '' }

export const sourceOf = (it: Pick<FeedItem, 'source' | 'parentSessionId'>): string => it.source ?? (it.parentSessionId ? 'subagent' : 'unknown')

/** The part of an item id after the message id, which orders the items that come from one message. */
function sequence(it: FeedItem): number {
  const n = Number(it.id.slice(it.id.lastIndexOf(':') + 1))
  return Number.isFinite(n) ? n : 0
}

/** Newest first. Ties (same second) fall back to the message id and then to the item's position in its message. */
export function compareFeed(a: FeedItem, b: FeedItem): number {
  if (a.ts !== b.ts) return b.ts - a.ts
  if (a.profile !== b.profile) return a.profile < b.profile ? -1 : 1
  if (a.messageId !== b.messageId) return b.messageId - a.messageId
  return sequence(b) - sequence(a)
}

/** Adds items to a newest-first list without duplicates and returns the new list and how many items were really new. */
export function mergeFeed(current: readonly FeedItem[], incoming: readonly FeedItem[], cap = FEED_CAP): { items: FeedItem[]; added: number } {
  if (incoming.length === 0) return { items: current as FeedItem[], added: 0 }
  const seen = new Set(current.map((i) => i.id))
  const fresh: FeedItem[] = []
  for (const it of incoming) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    fresh.push(it)
  }
  if (fresh.length === 0) return { items: current as FeedItem[], added: 0 }
  const items = [...current, ...fresh].sort(compareFeed)
  return { items: items.length > cap ? items.slice(0, cap) : items, added: fresh.length }
}

/** The lowest message id held per profile, which is where older history continues from. */
export function oldestPerProfile(items: readonly FeedItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const it of items) {
    const cur = out[it.profile]
    if (cur === undefined || it.messageId < cur) out[it.profile] = it.messageId
  }
  return out
}

export function filterFeed(items: readonly FeedItem[], f: FeedFilter): FeedItem[] {
  const q = f.query.trim().toLowerCase()
  const noFilter = f.hiddenAgents.length === 0 && f.hiddenKinds.length === 0 && f.hiddenSources.length === 0 && q === ''
  if (noFilter) return items as FeedItem[]
  return items.filter((it) => {
    if (f.hiddenAgents.includes(it.profile)) return false
    if (f.hiddenKinds.includes(it.kind)) return false
    if (f.hiddenSources.includes(sourceOf(it))) return false
    if (q && !(it.text.toLowerCase().includes(q) || (it.toolName ?? '').toLowerCase().includes(q))) return false
    return true
  })
}

export function sourcesOf(items: readonly FeedItem[]): string[] {
  return [...new Set(items.map(sourceOf))].sort()
}

export function toggled<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

const p2 = (n: number): string => String(n).padStart(2, '0')

/** Clock time of the user's own machine, HH:MM:SS. */
export function clock(ts: number): string {
  const d = new Date(ts * 1000)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

/** `HH:MM:SS`, or `Mon 14 · HH:MM:SS` when the item is not from today. */
export function clockWithDay(ts: number, now = Date.now()): string {
  const d = new Date(ts * 1000)
  const t = new Date(now)
  if (d.toDateString() === t.toDateString()) return clock(ts)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit' })} · ${clock(ts)}`
}

/** Tool arguments arrive as one JSON string; show them compact on one line, falling back to the raw text. */
export function toolPreview(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

export function isLong(it: Pick<FeedItem, 'text'>, limit = 320): boolean {
  return it.text.length > limit || it.text.split('\n').length > 6
}

/** A one-line summary of an agent's day for the detail card. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '$0'
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}
