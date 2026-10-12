import { describe, expect, it } from 'vitest'
import { CollectorEvent, InteractionDetail, parseEventLine } from '../../src/shared/events'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '../../src/shared/settings'

const src = { state: 'ok', unresolved: 0 }
const data = {
  since: 1,
  edges: [{ id: 'message:a>b:', kind: 'message', from: 'a', to: 'b', count: 2, firstTs: 1, lastTs: 2, label: 'msg', status: null }],
  rooms: [{ id: 'room:ops', name: 'ops', members: ['a'], lastTs: 2 }],
  subagents: [{ id: 'sub:a:s1', parent: 'a', status: 'running', lastTs: 2, title: null }],
  sources: { kanban: { state: 'absent', unresolved: 0 }, message: { state: 'ok', unresolved: 1 }, room: src, delegate: src }
}

describe('interactions contract', () => {
  it('parses an interactions event line and rejects an unknown kind', () => {
    expect(parseEventLine(JSON.stringify({ type: 'interactions', ts: 1, profile: null, data })).ok).toBe(true)
    const bad = { type: 'interactions', ts: 1, profile: null, data: { ...data, edges: [{ ...data.edges[0], kind: 'bogus' }] } }
    expect(CollectorEvent.safeParse(bad).success).toBe(false)
  })

  it('parses a detail', () => {
    expect(InteractionDetail.safeParse({ text: 'x', truncated: false, fullLen: 1, title: null, ts: null, source: 's', sessionId: null, profile: null }).success).toBe(true)
    expect(InteractionDetail.safeParse({ text: 'x' }).success).toBe(false)
  })

  it('has defaults for the saved graph settings', () => {
    expect(SETTINGS_DEFAULTS['dashboard.graphTab']).toBe('brain')
    expect(SETTINGS_SCHEMA['dashboard.agentGraph'].safeParse(SETTINGS_DEFAULTS['dashboard.agentGraph']).success).toBe(true)
    expect(SETTINGS_SCHEMA['dashboard.agentGraph'].safeParse({ kinds: ['x'], range: '1h' }).success).toBe(false)
    expect(SETTINGS_SCHEMA['dashboard.graphTab'].safeParse('agents').success).toBe(true)
  })
})
