import type { AgentInfo, AgentStatus } from '@shared/events'

export const SEARCH_THRESHOLD = 6
export const DEFAULT_PIN_COUNT = 5

const RANK: Record<AgentStatus, number> = { working: 0, idle: 1, parked: 2, offline: 3 }

export type RosterRow =
  | { kind: 'head'; key: string; title: string }
  | { kind: 'empty'; key: string; title: string }
  | { kind: 'agent'; key: string; agent: AgentInfo; pinned: boolean; draggable: boolean }

/**
 * The server's status only reflects what `state.db` and the gateway show, so an agent that is answering a chat from
 * this app can still look idle or offline. While a turn runs, the agent is shown as working (a parked one stays parked).
 */
export const withBusy = (agents: readonly AgentInfo[], busy: readonly string[]): AgentInfo[] =>
  busy.length === 0 ? [...agents] : agents.map((a) => (busy.includes(a.profile) && a.status !== 'parked' && a.status !== 'working' ? { ...a, status: 'working' as const } : a))

/** The local display names chosen in Settings → Agents → Profile (F-SHELL-6) over the names Hermes reports. */
export const withNames = (agents: AgentInfo[], names: Readonly<Record<string, string>>): AgentInfo[] =>
  agents.map((a) => (names[a.profile] ? { ...a, displayName: names[a.profile]! } : a))

export const isActive = (s: AgentStatus): boolean => s === 'working' || s === 'idle'
export const activeCount = (agents: readonly AgentInfo[]): number => agents.filter((a) => isActive(a.status)).length

export function sortAgents(agents: readonly AgentInfo[]): AgentInfo[] {
  return [...agents].sort((a, b) => RANK[a.status] - RANK[b.status] || a.displayName.localeCompare(b.displayName))
}

export function defaultPins(agents: readonly AgentInfo[]): string[] {
  return agents.slice(0, DEFAULT_PIN_COUNT).map((a) => a.profile)
}

export function togglePin(pins: readonly string[], profile: string): string[] {
  return pins.includes(profile) ? pins.filter((p) => p !== profile) : [...pins, profile]
}

export function reorderPins(pins: readonly string[], from: string, to: string): string[] {
  const fi = pins.indexOf(from)
  const ti = pins.indexOf(to)
  if (fi < 0 || ti < 0 || fi === ti) return [...pins]
  const next = pins.filter((p) => p !== from)
  next.splice(next.indexOf(to) + (fi < ti ? 1 : 0), 0, from)
  return next
}

export function buildRoster(
  agents: readonly AgentInfo[],
  pins: readonly string[],
  query: string
): { rows: RosterRow[]; showSearch: boolean } {
  const showSearch = agents.length > SEARCH_THRESHOLD
  const q = query.trim().toLowerCase()
  const row = (agent: AgentInfo, draggable: boolean): RosterRow => ({
    kind: 'agent',
    key: agent.profile,
    agent,
    pinned: pins.includes(agent.profile),
    draggable
  })

  if (q) {
    const hits = sortAgents(agents.filter((a) => a.displayName.toLowerCase().includes(q) || a.profile.toLowerCase().includes(q)))
    if (hits.length === 0) return { rows: [{ kind: 'empty', key: 'empty', title: `No agent matches “${query.trim()}”` }], showSearch }
    return { rows: [{ kind: 'head', key: 'h-res', title: `Results · ${hits.length}` }, ...hits.map((a) => row(a, false))], showSearch }
  }

  if (!showSearch) return { rows: sortAgents(agents).map((a) => row(a, false)), showSearch }

  const byProfile = new Map(agents.map((a) => [a.profile, a]))
  const pinned = pins.map((p) => byProfile.get(p)).filter((a): a is AgentInfo => a !== undefined)
  const pinnedSet = new Set(pinned.map((a) => a.profile))
  const others = sortAgents(agents.filter((a) => !pinnedSet.has(a.profile)))
  const rows: RosterRow[] = []
  if (others.length > 0 && pinned.length > 0) rows.push({ kind: 'head', key: 'h-pin', title: `Pinned · ${pinned.length}` })
  rows.push(...pinned.map((a) => row(a, true)))
  if (others.length > 0) rows.push({ kind: 'head', key: 'h-all', title: `All agents · ${others.length}` })
  rows.push(...others.map((a) => row(a, false)))
  return { rows, showSearch }
}

export function railAgents(
  agents: readonly AgentInfo[],
  pins: readonly string[],
  selected: string | null
): { shown: AgentInfo[]; more: number } {
  const byProfile = new Map(agents.map((a) => [a.profile, a]))
  const shown = pins.map((p) => byProfile.get(p)).filter((a): a is AgentInfo => a !== undefined)
  const sel = selected ? byProfile.get(selected) : undefined
  if (sel && !shown.includes(sel)) shown.push(sel)
  return { shown, more: agents.length - shown.length }
}
