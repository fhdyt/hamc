import { describe, expect, it } from 'vitest'
import type { InteractionsData } from '../../src/shared/events'
import { ACTIVE_S, buildGraph, describeNode, filterData, isActive, trimEnds } from '../../src/renderer/lib/agentGraph'

const ok = { state: 'ok', unresolved: 0 } as const
const sources = { kanban: ok, message: ok, room: ok, delegate: ok, peer: ok }
const NOW = 1_000_000
const ALL = ['kanban', 'message', 'room', 'delegate'] as const
const data: InteractionsData = {
  since: NOW - 7 * 86400,
  edges: [
    { id: 'm', kind: 'message', from: 'a', to: 'b', count: 2, firstTs: NOW - 5000, lastTs: NOW - 30, label: 'msg', status: null },
    { id: 'k', kind: 'kanban', from: 'b', to: 'c', count: 1, firstTs: NOW - 90000, lastTs: NOW - 90000, label: '#4', status: 'done' },
    { id: 'r', kind: 'room', from: 'a', to: 'room:ops', count: 1, firstTs: 0, lastTs: NOW - 200000, label: null, status: null },
    { id: 'd', kind: 'delegate', from: 'a', to: 'sub:a:s1', count: 1, firstTs: 0, lastTs: NOW - 10, label: null, status: null }
  ],
  rooms: [{ id: 'room:ops', name: 'ops', members: ['a'], lastTs: NOW - 200000 }],
  subagents: [{ id: 'sub:a:s1', parent: 'a', status: 'running', lastTs: NOW - 10, title: 'research' }],
  sources
}
const roster = (names: string[]) => names.map((p) => ({ profile: p, displayName: p.toUpperCase(), status: 'idle' }))

describe('agentGraph', () => {
  it('marks an edge active within 60 seconds, not after', () => {
    expect(ACTIVE_S).toBe(60)
    expect(isActive(NOW - 60, NOW)).toBe(true)
    expect(isActive(NOW - 61, NOW)).toBe(false)
  })

  it('filters by kinds and range and drops rooms and subagents left without an edge', () => {
    const f = filterData(data, ['message', 'kanban', 'room'], '24h', NOW)
    expect(f.edges.map((e) => e.id)).toEqual(['m'])
    expect(f.rooms).toEqual([])
    expect(f.subagents).toEqual([])
    expect(filterData(data, [...ALL], '7d', NOW).edges).toHaveLength(4)
    expect(filterData(data, [...ALL], '1h', NOW).edges.map((e) => e.id)).toEqual(['m', 'd'])
    const seven = filterData(data, [...ALL], '7d', NOW)
    expect(seven.rooms).toHaveLength(1)
    expect(seven.subagents).toHaveLength(1)
  })

  it('builds a deterministic layout with agents, a room and a subagent; quiet agents are dim', () => {
    const f = filterData(data, [...ALL], '7d', NOW)
    const g1 = buildGraph(roster(['a', 'b', 'c', 'z']), f, NOW)
    const g2 = buildGraph(roster(['a', 'b', 'c', 'z']), f, NOW)
    expect(g1).toEqual(g2)
    expect(g1.nodes.filter((n) => n.kind === 'agent')).toHaveLength(4)
    expect(g1.nodes.find((n) => n.id === 'z')!.dim).toBe(true)
    expect(g1.nodes.find((n) => n.id === 'a')!.dim).toBe(false)
    expect(g1.nodes.find((n) => n.id === 'sub:a:s1')).toMatchObject({ kind: 'sub', running: true, parent: 'a', label: 'research' })
    expect(g1.nodes.find((n) => n.id === 'room:ops')).toMatchObject({ kind: 'room', label: 'ops' })
    expect(g1.edges.find((e) => e.id === 'm')!.active).toBe(true)
    expect(g1.edges.find((e) => e.id === 'k')!.active).toBe(false)
  })

  it('drops an edge whose end is not in the roster', () => {
    const g = buildGraph(roster(['a', 'b']), filterData(data, [...ALL], '7d', NOW), NOW)
    expect(g.edges.map((e) => e.id).sort()).toEqual(['d', 'm', 'r'])
  })

  it('keeps nodes apart, even with 40 agents and subagents', () => {
    const many = roster(Array.from({ length: 40 }, (_, i) => `p${i}`))
    const subs = Array.from({ length: 6 }, (_, i) => ({ id: `sub:p3:s${i}`, parent: 'p3', status: 'done' as const, lastTs: NOW - 5, title: null }))
    const edges = subs.map((s, i) => ({ id: `d${i}`, kind: 'delegate' as const, from: 'p3', to: s.id, count: 1, firstTs: NOW - 5, lastTs: NOW - 5, label: null, status: null }))
    const g = buildGraph(many, { ...data, edges, rooms: [], subagents: subs }, NOW)
    for (let i = 0; i < g.nodes.length; i++) {
      for (let j = i + 1; j < g.nodes.length; j++) {
        const a = g.nodes[i]!
        const b = g.nodes[j]!
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.id} vs ${b.id}`).toBeGreaterThan((a.r + b.r) * 0.9)
      }
    }
  })

  it('counts the edges of a node by kind', () => {
    expect(describeNode('a', data.edges)).toEqual({ kanban: 0, message: 1, room: 1, delegate: 1, peer: 0 })
    expect(describeNode('nobody', data.edges)).toEqual({ kanban: 0, message: 0, room: 0, delegate: 0, peer: 0 })
  })

  it('trims a line so it starts and ends at the rim of the nodes', () => {
    const t = trimEnds({ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 20 }, 2)
    expect(t.x1).toBeCloseTo(12)
    expect(t.x2).toBeCloseTo(78)
    expect(t.y1).toBeCloseTo(0)
  })
})

describe('remote peers (F-AGRAPH-7)', () => {
  const peers: InteractionsData = {
    ...data,
    edges: [
      { id: 'p1', kind: 'peer', from: 'peer:dixie', to: 'a', count: 1, firstTs: NOW - 50, lastTs: NOW - 50, label: 'bot chat', status: null },
      { id: 'p2', kind: 'peer', from: 'a', to: 'peer:spark/researcher', count: 3, firstTs: NOW - 900, lastTs: NOW - 40, label: 'peer dm', status: null },
      { id: 'p3', kind: 'peer', from: 'peer:labbot', to: 'b', count: 1, firstTs: NOW - 80, lastTs: NOW - 80, label: 'a2a', status: null }
    ],
    rooms: [],
    subagents: []
  }

  it('adds an outer node for every remote end, outside the agent it talks to', () => {
    const g = buildGraph(roster(['a', 'b']), peers, NOW)
    const node = (id: string) => g.nodes.find((n) => n.id === id)!
    expect(g.nodes.filter((n) => n.kind === 'peer').map((n) => [n.id, n.label]).sort()).toEqual([
      ['peer:dixie', 'dixie'],
      ['peer:labbot', 'labbot'],
      ['peer:spark/researcher', 'spark/researcher']
    ])
    const a = node('a')
    for (const id of ['peer:dixie', 'peer:spark/researcher']) expect(Math.hypot(node(id).x, node(id).y)).toBeGreaterThan(Math.hypot(a.x, a.y))
    expect(g.edges).toHaveLength(3)
    expect(describeNode('a', peers.edges).peer).toBe(2)
  })

  it('is filtered like any other kind', () => {
    expect(filterData(peers, ['message'], '7d', NOW).edges).toEqual([])
    expect(filterData(peers, ['peer'], '7d', NOW).edges).toHaveLength(3)
  })
})
