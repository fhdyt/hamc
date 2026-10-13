import { describe, expect, it } from 'vitest'
import type { UsageRow } from '@shared/events'
import { buildDays, byAgent, byModel, daysOver, moneyLabel, niceTicks, summaryOf, unknownCostSessions } from '../../src/renderer/lib/usage'

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  day: 0, profile: 'default', provider: 'prov', model: 'm', sessions: 1, inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, apiCalls: null,
  cost: 1, estimatedCost: 0, unknownCost: 0, ...over
})
const STARTS = [1000, 87400, 173800]

describe('buildDays', () => {
  it('puts each row on its day, fills empty days and sums per agent', () => {
    const days = buildDays([row({ day: 0, cost: 1 }), row({ day: 0, profile: 'scout', cost: 2 }), row({ day: 2, cost: 4, estimatedCost: 4 })], STARTS)
    expect(days.map((d) => d.total)).toEqual([3, 0, 4])
    expect(days[0]!.byAgent).toEqual({ default: 1, scout: 2 })
    expect(days[1]!.byAgent).toEqual({})
    expect(days.map((d) => d.ts)).toEqual(STARTS)
    expect(days.map((d) => d.estimated)).toEqual([false, false, true])
    expect(days[2]!.index).toBe(2)
  })
  it('ignores a row with a day outside the range', () => {
    expect(buildDays([row({ day: 9 })], STARTS).map((d) => d.total)).toEqual([0, 0, 0])
  })
})

describe('byAgent', () => {
  const rows = [row({ day: 0, cost: 1 }), row({ day: 1, cost: 3, inputTokens: 50 }), row({ day: 1, profile: 'scout', cost: 5, estimatedCost: 1 })]
  it('sums the whole range, biggest cost first, with shares that add up', () => {
    const lines = byAgent(rows, null)
    expect(lines.map((l) => l.profile)).toEqual(['scout', 'default'])
    expect(lines[1]).toMatchObject({ sessions: 2, inputTokens: 150, cost: 4, estimated: false })
    expect(lines[0]!.estimated).toBe(true)
    expect(lines.reduce((s, l) => s + l.share, 0)).toBeCloseTo(1)
  })
  it('follows one day', () => {
    expect(byAgent(rows, 0).map((l) => [l.profile, l.cost])).toEqual([['default', 1]])
  })
  it('has a zero share when nothing was spent', () => {
    expect(byAgent([row({ cost: 0 })], null)[0]!.share).toBe(0)
  })
})

describe('byModel', () => {
  it('groups by provider and model and sums API calls only when known', () => {
    const rows = [row({ apiCalls: 2, cost: 1 }), row({ apiCalls: 3, cost: 2 }), row({ model: 'n', provider: 'other', cost: 5 })]
    const lines = byModel(rows, null)
    expect(lines.map((l) => [l.provider, l.model, l.cost, l.apiCalls])).toEqual([['other', 'n', 5, null], ['prov', 'm', 3, 5]])
    expect(lines[1]!.sessions).toBe(2)
  })
})

describe('summaryOf', () => {
  it('gives the total, the average per day and today (the last day)', () => {
    const days = buildDays([row({ day: 0, cost: 3 }), row({ day: 2, cost: 6 })], STARTS)
    expect(summaryOf(days)).toEqual({ total: 9, average: 3, today: 6 })
  })
})

describe('niceTicks', () => {
  it('rounds the top up to a round number', () => {
    expect(niceTicks(37.4)).toEqual({ max: 40, ticks: [0, 10, 20, 30, 40] })
    expect(niceTicks(1234).max).toBeGreaterThanOrEqual(1234)
  })
  it('keeps the invariants for tiny and zero values', () => {
    for (const v of [0, 0.004, 0.8, 1234, 99999]) {
      const { max, ticks } = niceTicks(v)
      expect(ticks[0]).toBe(0)
      expect(ticks.at(-1)).toBe(max)
      expect(max).toBeGreaterThanOrEqual(v)
      expect(ticks.length).toBeLessThanOrEqual(7)
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!)
    }
  })
})

describe('daysOver and labels', () => {
  it('lists the days strictly above the threshold', () => {
    const days = buildDays([row({ day: 0, cost: 10 }), row({ day: 1, cost: 10.5 }), row({ day: 2, cost: 30 })], STARTS)
    expect(daysOver(days, 10)).toEqual([1, 2])
  })
  it('formats money', () => {
    expect(moneyLabel(12.345)).toBe('$12.35')
    expect(moneyLabel(0)).toBe('$0.00')
    expect(moneyLabel(0.004)).toBe('<$0.01')
    expect(moneyLabel(3, true)).toBe('$3.00 est.')
  })
  it('counts sessions without a cost figure', () => {
    expect(unknownCostSessions([row({ unknownCost: 2 }), row({ unknownCost: 1 }), row()])).toBe(3)
  })
})
