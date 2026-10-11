import { describe, expect, it } from 'vitest'
import { parseEventLine } from '@shared/events'
import { sampleAgents, sampleCron, sampleJob, sampleMetrics } from '../helpers/samples'

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
