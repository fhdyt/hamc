import type { InteractionEdge, InteractionKind, InteractionsData } from '@shared/events'

export type Range = '1h' | '24h' | '7d'

/** Colours of the Dracula tokens, one per kind of interaction (PRD 6.6b, F-AGRAPH-3). */
export const KIND_COLOR: Record<InteractionKind, string> = { kanban: '#FFB86C', message: '#FF79C6', room: '#BD93F9', delegate: '#8BE9FD' }
export const KIND_LABEL: Record<InteractionKind, string> = { kanban: 'kanban', message: 'messages', room: 'rooms', delegate: 'subagents' }
export const KINDS: InteractionKind[] = ['kanban', 'message', 'room', 'delegate']
export const RANGE_S: Record<Range, number> = { '1h': 3600, '24h': 86400, '7d': 7 * 86400 }
export const RANGE_LABEL: Record<Range, string> = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' }
/** An interaction with an event in the last minute is shown as active (F-AGRAPH-4). */
export const ACTIVE_S = 60

export const isActive = (lastTs: number, now: number): boolean => now - lastTs <= ACTIVE_S

/** Applies the kinds and the time range; a room or subagent with no edge left goes too. `now` is in epoch seconds. */
export function filterData(data: InteractionsData, kinds: readonly InteractionKind[], range: Range, now: number): InteractionsData {
  const edges = data.edges.filter((e) => kinds.includes(e.kind) && e.lastTs >= now - RANGE_S[range])
  const ends = new Set(edges.map((e) => e.to))
  return { ...data, edges, rooms: data.rooms.filter((r) => ends.has(r.id)), subagents: data.subagents.filter((s) => ends.has(s.id)) }
}

export interface RosterAgent {
  profile: string
  displayName: string
  status: string
}

export interface GNode {
  id: string
  kind: 'agent' | 'room' | 'sub'
  label: string
  status?: string
  x: number
  y: number
  r: number
  dim: boolean
  parent?: string
  running?: boolean
}

export type GEdge = InteractionEdge & { active: boolean }

export interface Graph {
  nodes: GNode[]
  edges: GEdge[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const ROOM_R = 20
const SUB_R = 11
const INNER = 90

/**
 * Places the agents on a circle (in roster order, starting at the top), rooms on an inner ring towards their members
 * and subagents just outside their parent. Pure and deterministic, so nodes never jump when a snapshot arrives.
 */
export function buildGraph(agents: readonly RosterAgent[], data: InteractionsData, now: number): Graph {
  const n = agents.length
  const ar = n > 20 ? 18 : 26
  const R = n <= 1 ? 0 : Math.max(230, (2 * ar + 16) / (2 * Math.sin(Math.PI / n)))
  const angleOf = new Map<string, number>()
  const nodes: GNode[] = []
  agents.forEach((a, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1)
    angleOf.set(a.profile, ang)
    nodes.push({ id: a.profile, kind: 'agent', label: a.displayName, status: a.status, x: Math.cos(ang) * R, y: Math.sin(ang) * R, r: ar, dim: true })
  })
  const pos = new Map(nodes.map((nd) => [nd.id, nd]))

  const placedRooms: number[] = []
  for (const room of data.rooms) {
    const members = room.members.filter((m) => angleOf.has(m))
    const ang = members.length === 0 ? -Math.PI / 2 : Math.atan2(members.reduce((s, m) => s + Math.sin(angleOf.get(m)!), 0), members.reduce((s, m) => s + Math.cos(angleOf.get(m)!), 0))
    const crowd = placedRooms.filter((p) => Math.abs(Math.atan2(Math.sin(p - ang), Math.cos(p - ang))) < 0.5).length
    placedRooms.push(ang)
    const rad = Math.min(INNER + 34 * crowd, Math.max(INNER, R - ar - ROOM_R - 20))
    nodes.push({ id: room.id, kind: 'room', label: room.name, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, r: ROOM_R, dim: false })
  }

  const perParent = new Map<string, number>()
  for (const sub of data.subagents) {
    const parent = pos.get(sub.parent)
    if (!parent) continue
    const k = perParent.get(sub.parent) ?? 0
    perParent.set(sub.parent, k + 1)
    const out = parent.x === 0 && parent.y === 0 ? -Math.PI / 2 : Math.atan2(parent.y, parent.x)
    const ang = out + ((k % 5) - 2) * 0.45
    const dist = parent.r + 34 + 24 * Math.floor(k / 5)
    nodes.push({ id: sub.id, kind: 'sub', label: sub.title ?? 'subagent', x: parent.x + Math.cos(ang) * dist, y: parent.y + Math.sin(ang) * dist, r: SUB_R, dim: false, parent: sub.parent, running: sub.status === 'running' })
  }

  const have = new Set(nodes.map((nd) => nd.id))
  const edges: GEdge[] = data.edges.filter((e) => have.has(e.from) && have.has(e.to)).map((e) => ({ ...e, active: isActive(e.lastTs, now) }))
  const touched = new Set(edges.flatMap((e) => [e.from, e.to]))
  for (const nd of nodes) if (nd.kind === 'agent') nd.dim = !touched.has(nd.id)

  const pad = 40
  const xs = nodes.map((nd) => [nd.x - nd.r, nd.x + nd.r]).flat()
  const ys = nodes.map((nd) => [nd.y - nd.r, nd.y + nd.r]).flat()
  const bounds = nodes.length === 0 ? { minX: -300, minY: -300, maxX: 300, maxY: 300 } : { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad }
  return { nodes, edges, bounds }
}

/** How many edges of each kind touch a node. */
export function describeNode(id: string, edges: readonly InteractionEdge[]): Record<InteractionKind, number> {
  const out: Record<InteractionKind, number> = { kanban: 0, message: 0, room: 0, delegate: 0 }
  for (const e of edges) if (e.from === id || e.to === id) out[e.kind]++
  return out
}

/** The ends of the line between two nodes, pulled back to their rims. */
export function trimEnds(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }, gap = 2): { x1: number; y1: number; x2: number; y2: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return { x1: a.x + ux * (a.r + gap), y1: a.y + uy * (a.r + gap), x2: b.x - ux * (b.r + gap), y2: b.y - uy * (b.r + gap) }
}
