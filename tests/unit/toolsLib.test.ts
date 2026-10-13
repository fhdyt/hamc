import { describe, expect, it } from 'vitest'
import type { ToolStat } from '@shared/events'
import { durationLabel, failureRate, shareOf, sortTools } from '../../src/renderer/lib/tools'

const tool = (name: string, over: Partial<ToolStat> = {}): ToolStat => ({
  name, calls: 10, errors: 0, avgMs: 100, maxMs: 200, lastTs: 1, byProfile: {}, failures: [], ...over
})

describe('sortTools', () => {
  const tools = [tool('a', { calls: 5, errors: 3, avgMs: 50 }), tool('b', { calls: 20, errors: 1, avgMs: null }), tool('c', { calls: 8, errors: 3, avgMs: 900 })]
  it('sorts by calls, errors and time', () => {
    expect(sortTools(tools, 'calls').map((t) => t.name)).toEqual(['b', 'c', 'a'])
    expect(sortTools(tools, 'errors').map((t) => t.name)).toEqual(['c', 'a', 'b'])
    expect(sortTools(tools, 'time').map((t) => t.name)).toEqual(['c', 'a', 'b'])
  })
  it('does not change the input', () => {
    const copy = [...tools]
    sortTools(tools, 'errors')
    expect(tools).toEqual(copy)
  })
})

describe('numbers', () => {
  it('computes the failure rate and the share', () => {
    expect(failureRate(tool('x', { calls: 8, errors: 2 }))).toBe(0.25)
    expect(failureRate(tool('x', { calls: 0, errors: 0 }))).toBe(0)
    expect(shareOf(tool('x', { calls: 5 }), 20)).toBe(25)
    expect(shareOf(tool('x', { calls: 5 }), 0)).toBe(0)
  })
  it('formats durations', () => {
    expect(durationLabel(null)).toBe('—')
    expect(durationLabel(240)).toBe('240 ms')
    expect(durationLabel(1200)).toBe('1.2 s')
    expect(durationLabel(125000)).toBe('2m 05s')
  })
})
