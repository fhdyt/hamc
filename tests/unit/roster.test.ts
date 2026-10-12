import { describe, expect, it } from 'vitest'
import type { AgentInfo, AgentStatus } from '@shared/events'
import {
  activeCount, buildRoster, defaultPins, railAgents, reorderPins, sortAgents, togglePin, withBusy, type RosterRow
} from '../../src/renderer/lib/roster'

const label = (x: RosterRow): string => (x.kind === 'agent' ? x.agent.profile : x.title)

const agent = (profile: string, status: AgentStatus = 'idle', displayName = profile): AgentInfo => ({
  profile, displayName, status, platforms: [], lastActivityTs: null, configMtime: null, hasSoul: false, hasMemory: false, hasUser: false
})
const many = (n: number): AgentInfo[] => Array.from({ length: n }, (_, i) => agent(`a${String(i).padStart(2, '0')}`))

describe('sorting and counting', () => {
  it('orders working, idle, parked, offline, then by name', () => {
    const s = sortAgents([agent('z', 'offline'), agent('b', 'idle'), agent('a', 'idle'), agent('p', 'parked'), agent('w', 'working')])
    expect(s.map((a) => a.profile)).toEqual(['w', 'a', 'b', 'p', 'z'])
  })
  it('counts working and idle as active', () => {
    expect(activeCount([agent('a', 'working'), agent('b', 'idle'), agent('c', 'parked'), agent('d', 'offline')])).toBe(2)
  })
})

describe('pins', () => {
  it('pins the first five agents by default', () => {
    expect(defaultPins(many(8))).toEqual(['a00', 'a01', 'a02', 'a03', 'a04'])
    expect(defaultPins(many(2))).toEqual(['a00', 'a01'])
  })
  it('toggles', () => {
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b'])
  })
  it('reorders by moving one pin to the position of another', () => {
    expect(reorderPins(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderPins(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(reorderPins(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
  })
})

describe('buildRoster', () => {
  it('shows a single flat list without groups or search for up to six agents', () => {
    const r = buildRoster(many(6), ['a00'], '')
    expect(r.showSearch).toBe(false)
    expect(r.rows.every((x) => x.kind === 'agent')).toBe(true)
    expect(r.rows).toHaveLength(6)
  })

  it('groups into Pinned and All agents above six', () => {
    const r = buildRoster(many(8), ['a05', 'a02'], '')
    expect(r.showSearch).toBe(true)
    expect(r.rows.map(label)).toEqual([
      'Pinned · 2', 'a05', 'a02', 'All agents · 6', 'a00', 'a01', 'a03', 'a04', 'a06', 'a07'
    ])
    expect(r.rows.find((x) => x.kind === 'agent' && x.agent.profile === 'a05')).toMatchObject({ pinned: true, draggable: true })
    expect(r.rows.find((x) => x.kind === 'agent' && x.agent.profile === 'a00')).toMatchObject({ pinned: false, draggable: false })
  })

  it('omits headings when everything is pinned', () => {
    const r = buildRoster(many(7), many(7).map((a) => a.profile), '')
    expect(r.rows.every((x) => x.kind === 'agent')).toBe(true)
  })

  it('ignores pins for agents that no longer exist', () => {
    const r = buildRoster(many(7), ['gone', 'a01'], '')
    expect(r.rows[0]).toMatchObject({ kind: 'head', title: 'Pinned · 1' })
  })

  it('searches display names and profiles into a flat Results list', () => {
    const agents = [...many(7), agent('scout', 'working', 'Scout Prime')]
    const r = buildRoster(agents, ['a00'], '  prime ')
    expect(r.rows.map(label)).toEqual(['Results · 1', 'scout'])
    expect(r.rows[1]).toMatchObject({ draggable: false })
  })

  it('explains an empty search', () => {
    const r = buildRoster(many(7), [], 'zzz')
    expect(r.rows).toEqual([{ kind: 'empty', key: 'empty', title: 'No agent matches “zzz”' }])
  })
})

describe('railAgents', () => {
  it('shows pinned agents plus the selected one and counts the rest', () => {
    const r = railAgents(many(8), ['a03', 'a01'], 'a06')
    expect(r.shown.map((a) => a.profile)).toEqual(['a03', 'a01', 'a06'])
    expect(r.more).toBe(5)
  })
  it('does not duplicate a selected pinned agent', () => {
    expect(railAgents(many(3), ['a00'], 'a00').shown).toHaveLength(1)
  })
})

describe('withBusy', () => {
  it('shows an agent that is answering a chat as working, whatever the server says', () => {
    const list = [agent('a', 'idle'), agent('b', 'offline'), agent('c', 'parked'), agent('d', 'idle')]
    const r = withBusy(list, ['a', 'b', 'c'])
    expect(r.map((x) => x.status)).toEqual(['working', 'working', 'parked', 'idle'])
    expect(list[0]!.status).toBe('idle')
  })
  it('changes nothing when no chat is running', () => {
    const list = [agent('a', 'idle')]
    expect(withBusy(list, [])).toEqual(list)
  })
})
