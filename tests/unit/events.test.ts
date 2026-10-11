import { describe, expect, it } from 'vitest'
import { FeedHistory, FeedMessageText, SessionDetail, parseEventLine } from '@shared/events'
import { sampleAgents, sampleCron, sampleFeed, sampleItem, sampleJob, sampleMetrics } from '../helpers/samples'

const line = (o: unknown): string => JSON.stringify(o)

describe('parseEventLine', () => {
  it('accepts a metrics event', () => {
    const r = parseEventLine(line({ type: 'metrics', ts: 1, profile: null, data: sampleMetrics() }))
    expect(r.ok).toBe(true)
  })

  it('accepts an agents event', () => {
    const r = parseEventLine(line({ type: 'agents', ts: 1, profile: null, data: sampleAgents() }))
    expect(r.ok).toBe(true)
  })

  it('accepts an error event', () => {
    const r = parseEventLine(line({ type: 'error', ts: 1, profile: 'scout', data: { code: 'unsupported_schema', message: 'x' } }))
    expect(r.ok).toBe(true)
  })

  it('rejects invalid json', () => {
    expect(parseEventLine('{nope')).toEqual({ ok: false, error: 'invalid JSON' })
  })

  it('rejects an unknown type', () => {
    expect(parseEventLine(line({ type: 'nope', ts: 1, profile: null, data: {} })).ok).toBe(false)
  })

  it('rejects metrics with a wrong shape', () => {
    const bad = sampleMetrics()
    const r = parseEventLine(line({ type: 'metrics', ts: 1, profile: null, data: { ...bad, cpu: { total: 'x' } } }))
    expect(r.ok).toBe(false)
  })

  it('rejects an unknown agent status', () => {
    const a = sampleAgents()
    a.agents[0] = { ...a.agents[0]!, status: 'sleeping' as never }
    expect(parseEventLine(line({ type: 'agents', ts: 1, profile: null, data: a })).ok).toBe(false)
  })
})

describe('cron events', () => {
  it('accepts a cron event', () => {
    expect(parseEventLine(line({ type: 'cron', ts: 1, profile: null, data: sampleCron() })).ok).toBe(true)
  })

  it('accepts a job that never ran and has no output', () => {
    const data = { jobs: [sampleJob({ lastStatus: null, lastRunTs: null, lastOutput: null, nextRunTs: null, tzOffsetMin: null })], profiles: [] }
    expect(parseEventLine(line({ type: 'cron', ts: 1, profile: null, data })).ok).toBe(true)
  })

  it('accepts a profile error note', () => {
    const data = { jobs: [], profiles: [{ profile: 'x', ok: false, error: 'invalid_json' }] }
    expect(parseEventLine(line({ type: 'cron', ts: 1, profile: null, data })).ok).toBe(true)
  })

  it('rejects a state outside the enum', () => {
    const data = { jobs: [{ ...sampleJob(), state: 'sleeping' }], profiles: [] }
    expect(parseEventLine(line({ type: 'cron', ts: 1, profile: null, data })).ok).toBe(false)
  })

  it('rejects a schedule without a display', () => {
    const bad = { ...sampleJob(), schedule: { kind: 'cron', expr: null } }
    expect(parseEventLine(line({ type: 'cron', ts: 1, profile: null, data: { jobs: [bad], profiles: [] } })).ok).toBe(false)
  })
})

describe('feed events', () => {
  it('accepts a feed event with all five kinds', () => {
    const data = sampleFeed()
    expect(new Set(data.items.map((i) => i.kind))).toEqual(new Set(['user', 'thinking', 'tool', 'result', 'reply']))
    expect(parseEventLine(line({ type: 'feed', ts: 1, profile: null, data })).ok).toBe(true)
  })

  it('rejects an unknown kind and a missing cursor map', () => {
    const bad = { ...sampleFeed(), items: [{ ...sampleItem(), kind: 'shout' }] }
    expect(parseEventLine(line({ type: 'feed', ts: 1, profile: null, data: bad })).ok).toBe(false)
    const { cursors: _c, ...noCursors } = sampleFeed()
    expect(parseEventLine(line({ type: 'feed', ts: 1, profile: null, data: noCursors })).ok).toBe(false)
  })

  it('accepts agents with and without daily stats', () => {
    const base = sampleAgents()
    const stats = { sessions: 1, messages: 4, toolCalls: 1, inputTokens: 100, outputTokens: 50, reasoningTokens: 10, costUsd: 0.02 }
    base.agents[0] = { ...base.agents[0]!, stats }
    base.agents[1] = { ...base.agents[1]!, stats: null }
    expect(parseEventLine(line({ type: 'agents', ts: 1, profile: null, data: base })).ok).toBe(true)
    const old = sampleAgents()
    expect(parseEventLine(line({ type: 'agents', ts: 1, profile: null, data: old })).ok).toBe(true)
  })

  it('rejects negative stats', () => {
    const base = sampleAgents()
    base.agents[0] = { ...base.agents[0]!, stats: { sessions: -1, messages: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 } }
    expect(parseEventLine(line({ type: 'agents', ts: 1, profile: null, data: base })).ok).toBe(false)
  })
})

describe('query result schemas', () => {
  it('parse a message text', () => {
    expect(FeedMessageText.safeParse({ text: 'x', truncated: false, fullLen: 1 }).success).toBe(true)
    expect(FeedMessageText.safeParse({ text: 'x' }).success).toBe(false)
  })

  it('parse a history page with null oldest ids', () => {
    const ok = { items: [sampleItem()], oldest: { default: 3, ghost: null }, exhausted: { default: false, ghost: true } }
    expect(FeedHistory.safeParse(ok).success).toBe(true)
    expect(FeedHistory.safeParse({ ...ok, exhausted: { default: 'no' } }).success).toBe(false)
  })

  it('parse a session with children', () => {
    const ok = {
      session: { id: 's', source: 'cron', model: null, parentSessionId: null, startedAt: 1, endedAt: null, title: null },
      children: [{ id: 'c', source: 'subagent' }],
      items: [sampleItem()],
      more: false
    }
    expect(SessionDetail.safeParse(ok).success).toBe(true)
    expect(SessionDetail.safeParse({ ...ok, children: [{ source: 'x' }] }).success).toBe(false)
  })
})
