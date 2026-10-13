import { FILE_LABEL } from '@shared/agentCfg'
import type { SessionRow } from '@shared/events'
import { NAV } from '../shell/nav'
import type { AgentTab } from '../stores/agentCfg'
import type { Route } from '../stores/ui'
import { formatAge } from './format'

export type PaletteGroup = 'screen' | 'action' | 'agent' | 'session' | 'note'

/** What running an item does, as data so it can be tested; `paletteActions.runItem` carries it out. */
export type PaletteTarget =
  | { kind: 'screen'; route: Route }
  | { kind: 'chat'; profile: string }
  | { kind: 'agent-settings'; profile: string; tab: AgentTab }
  | { kind: 'session'; profile: string; id: string }
  | { kind: 'note'; id: string }
  | { kind: 'action'; action: 'settings' | 'connection' | 'cron' | 'cost-today' | 'errors-hour' | 'terminal' }

export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  hint?: string
  keywords?: string
  target: PaletteTarget
}

const GROUP_ORDER: Record<PaletteGroup, number> = { screen: 0, action: 1, agent: 2, session: 3, note: 4 }
const NOT_BUILT: readonly Route[] = []
const AGENT_TABS: { tab: AgentTab; label: string }[] = [
  { tab: 'model', label: 'Model' },
  { tab: 'soul', label: FILE_LABEL.soul },
  { tab: 'memory', label: 'Memory' },
  { tab: 'user', label: 'User profile' }
]
const ACTIONS: { action: 'settings' | 'connection' | 'cron' | 'cost-today' | 'errors-hour' | 'terminal'; label: string; keywords: string }[] = [
  { action: 'settings', label: 'Open Settings', keywords: 'preferences options general' },
  { action: 'connection', label: 'Open connection settings', keywords: 'server host ssh vps' },
  { action: 'cron', label: 'Open Cron jobs', keywords: 'schedule scheduler jobs' },
  { action: 'cost-today', label: "Show today's cost", keywords: 'usage spend money budget price' },
  { action: 'errors-hour', label: 'Show errors from the last hour', keywords: 'logs failures problems errors' },
  { action: 'terminal', label: 'Open or close the terminal', keywords: 'shell ssh console bash command line' }
]

/** Lowercase with accents removed, so "Café" and "cafe" meet. */
export const normalize = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** 0 for no match; exact 100, prefix 80, word prefix 60, substring 40, letters in order 20. */
export function scoreText(text: string, query: string): number {
  const t = normalize(text)
  const q = normalize(query).trim()
  if (q === '' || t === '') return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.split(/[^a-z0-9]+/).some((w) => w !== '' && w.startsWith(q))) return 60
  if (t.includes(q)) return 40
  let i = 0
  for (const ch of t) if (ch === q[i] && ++i === q.length) return 20
  return 0
}

export interface PaletteInput {
  agents: readonly { profile: string; displayName: string }[]
  sessions: readonly SessionRow[]
  notes: readonly { id: string; title: string }[]
  /** Epoch seconds, for the age of a session. */
  now: number
}

export function buildItems({ agents, sessions, notes, now }: PaletteInput): PaletteItem[] {
  const names = new Map(agents.map((a) => [a.profile, a.displayName]))
  const items: PaletteItem[] = []
  for (const n of NAV) {
    items.push({
      id: `screen:${n.id}`,
      group: 'screen',
      label: n.label,
      hint: `Ctrl+${n.key}${NOT_BUILT.includes(n.id) ? ' · Coming in a later release' : ''}`,
      keywords: n.id,
      target: { kind: 'screen', route: n.id }
    })
  }
  for (const a of ACTIONS) items.push({ id: `action:${a.action}`, group: 'action', label: a.label, keywords: a.keywords, target: { kind: 'action', action: a.action } })
  for (const a of agents) {
    items.push({ id: `chat:${a.profile}`, group: 'agent', label: `Chat with ${a.displayName}`, keywords: `${a.profile} message talk`, target: { kind: 'chat', profile: a.profile } })
    for (const t of AGENT_TABS) {
      items.push({
        id: `agent-settings:${a.profile}:${t.tab}`,
        group: 'agent',
        label: `${a.displayName} · ${t.label}`,
        keywords: `${a.profile} settings`,
        target: { kind: 'agent-settings', profile: a.profile, tab: t.tab }
      })
    }
  }
  for (const s of sessions) {
    const who = names.get(s.profile) ?? s.profile
    const age = s.startedAt === null ? 'unknown time' : formatAge(Math.max(0, now - s.startedAt))
    items.push({
      id: `session:${s.profile}:${s.id}`,
      group: 'session',
      label: s.title ?? 'Untitled session',
      hint: `${who} · ${s.source ?? 'unknown'} · ${age}`,
      keywords: s.id,
      target: { kind: 'session', profile: s.profile, id: s.id }
    })
  }
  for (const n of notes) items.push({ id: `note:${n.id}`, group: 'note', label: n.title, hint: n.id, target: { kind: 'note', id: n.id } })
  return items
}

const PER_GROUP_CAP: Partial<Record<PaletteGroup, number>> = { session: 8, note: 8 }
const EMPTY_QUERY_CAP: Partial<Record<PaletteGroup, number>> = { session: 5, note: 5 }

/** The list the palette shows: screens, actions, then a few of the newest sessions and notes for an empty query; ranked matches otherwise. */
export function searchItems(items: readonly PaletteItem[], query: string, limit = 40): PaletteItem[] {
  const q = query.trim()
  const taken: Record<string, number> = {}
  const take = (list: PaletteItem[], caps: Partial<Record<PaletteGroup, number>>): PaletteItem[] =>
    list.filter((i) => {
      const cap = caps[i.group]
      if (cap === undefined) return true
      taken[i.group] = (taken[i.group] ?? 0) + 1
      return taken[i.group]! <= cap
    })
  if (q === '') {
    const base = items.filter((i) => i.group === 'screen' || i.group === 'action')
    const rest = take(items.filter((i) => i.group === 'session' || i.group === 'note'), EMPTY_QUERY_CAP)
    return [...base, ...rest].slice(0, limit)
  }
  const scored = items
    .map((i) => ({ i, s: Math.max(scoreText(i.label, q), scoreText(i.keywords ?? '', q) * 0.9, Math.floor(scoreText(i.hint ?? '', q) / 2)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || GROUP_ORDER[a.i.group] - GROUP_ORDER[b.i.group] || (a.i.label < b.i.label ? -1 : 1))
  return take(scored.map((x) => x.i), PER_GROUP_CAP).slice(0, limit)
}
