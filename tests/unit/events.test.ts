import { describe, expect, it } from 'vitest'
import { parseEventLine } from '@shared/events'
import { sampleAgents, sampleMetrics } from '../helpers/samples'

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
