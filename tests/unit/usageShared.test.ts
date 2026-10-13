import { describe, expect, it } from 'vitest'
import { CostAlertState, ToolStat, UsageSummary, UsageTools } from '@shared/events'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '@shared/settings'
import { RANGES, sinceFor } from '@shared/sessions'
import { COST_DEFAULT, dayStartsFor, localDayKey, usageDays, validCostThreshold } from '@shared/usage'

describe('usageDays', () => {
  it('maps the shared range to 7, 14 or 30 days', () => {
    expect(usageDays('today')).toBe(7)
    expect(usageDays('7d')).toBe(7)
    expect(usageDays('14d')).toBe(14)
    expect(usageDays('30d')).toBe(30)
    expect(usageDays('all')).toBe(30)
  })
})

describe('dayStartsFor', () => {
  const now = new Date(2026, 9, 13, 15, 30).getTime() / 1000
  it('lists local midnights ascending, ending with today, and the next midnight', () => {
    const { dayStarts, endTs } = dayStartsFor(3, now)
    expect(dayStarts).toEqual([new Date(2026, 9, 11).getTime() / 1000, new Date(2026, 9, 12).getTime() / 1000, new Date(2026, 9, 13).getTime() / 1000])
    expect(endTs).toBe(new Date(2026, 9, 14).getTime() / 1000)
  })
  it('crosses a month end', () => {
    const { dayStarts } = dayStartsFor(2, new Date(2026, 10, 1, 1).getTime() / 1000)
    expect(dayStarts[0]).toBe(new Date(2026, 9, 31).getTime() / 1000)
  })
  it('names a day by its local date', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59).getTime() / 1000)).toBe('2026-01-05')
  })
})

describe('cost threshold', () => {
  it('accepts 0.01 to 100000', () => {
    expect(validCostThreshold(0.01)).toBe(true)
    expect(validCostThreshold(100000)).toBe(true)
    expect(validCostThreshold(0)).toBe(false)
    expect(validCostThreshold(100001)).toBe(false)
    expect(validCostThreshold('5')).toBe(false)
    expect(validCostThreshold(Number.NaN)).toBe(false)
  })
})

describe('settings and range', () => {
  it('has the cost alert settings and the 14d range', () => {
    expect(SETTINGS_DEFAULTS['alerts.cost.enabled']).toBe(false)
    expect(SETTINGS_DEFAULTS['alerts.cost.usd']).toBe(COST_DEFAULT)
    expect(SETTINGS_SCHEMA['alerts.cost.usd'].safeParse(0).success).toBe(false)
    expect(SETTINGS_SCHEMA['alerts.cost.usd'].safeParse(12.5).success).toBe(true)
    expect(SETTINGS_SCHEMA['filters.range'].safeParse('14d').success).toBe(true)
    expect(RANGES).toContain('14d')
    expect(sinceFor('14d', 1_000_000)).toBe(1_000_000 - 14 * 86400)
  })
})

describe('schemas', () => {
  it('parse a summary, tools and an alert state', () => {
    const row = { day: 0, profile: 'default', provider: 'openrouter', model: 'm', sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, apiCalls: null, cost: 0.1, estimatedCost: 0, unknownCost: 0 }
    expect(UsageSummary.parse({ rows: [row], truncated: false, errors: [] }).rows).toHaveLength(1)
    const tool = { name: 'x', calls: 2, errors: 1, avgMs: 10, maxMs: 20, lastTs: 5, byProfile: { default: 2 }, failures: [{ profile: 'default', sessionId: 's', ts: 5, text: 'Error' }] }
    expect(ToolStat.parse(tool).errors).toBe(1)
    expect(UsageTools.parse({ tools: [tool], scanned: 2, truncated: false, errors: [] }).scanned).toBe(2)
    expect(CostAlertState.parse({ enabled: true, day: '2026-10-13', total: 12, threshold: 10, over: true, checkedAt: 1 }).over).toBe(true)
  })
})
