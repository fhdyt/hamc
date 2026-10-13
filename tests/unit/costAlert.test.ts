import { describe, expect, it, vi } from 'vitest'
import type { UsageRow, UsageSummary } from '@shared/events'
import type { QueryResult } from '@shared/ipc'
import type { UsageSummaryArgs } from '@shared/usage'
import { CostAlertService, evaluateCost } from '../../src/main/usage/costAlert'

describe('evaluateCost', () => {
  it('is over only when enabled and the total is above the threshold', () => {
    expect(evaluateCost(12, true, 10, null, 'd1')).toEqual({ over: true, notify: true })
    expect(evaluateCost(10, true, 10, null, 'd1')).toEqual({ over: false, notify: false })
    expect(evaluateCost(12, false, 10, null, 'd1')).toEqual({ over: false, notify: false })
  })
  it('notifies once per local day', () => {
    expect(evaluateCost(12, true, 10, 'd1', 'd1')).toEqual({ over: true, notify: false })
    expect(evaluateCost(12, true, 10, 'd1', 'd2')).toEqual({ over: true, notify: true })
  })
})

const row = (profile: string, cost: number): UsageRow => ({
  day: 0, profile, provider: null, model: null, sessions: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, apiCalls: null, cost, estimatedCost: 0, unknownCost: 0
})
const ok = (cost: number): QueryResult<UsageSummary> => ({ ok: true, data: { rows: [row('a', cost / 2), row('b', cost / 2)], truncated: false, errors: [] } })

function make(over: { cost?: number; enabled?: boolean; connected?: boolean; now?: () => number } = {}) {
  const sent = vi.fn()
  const notified = vi.fn()
  const state = { cost: over.cost ?? 12, enabled: over.enabled ?? true, connected: over.connected ?? true }
  const query = vi.fn(async (_a: UsageSummaryArgs): Promise<QueryResult<UsageSummary>> => ok(state.cost))
  const svc = new CostAlertService({
    query,
    settings: () => ({ enabled: state.enabled, usd: 10 }),
    isConnected: () => state.connected,
    send: sent,
    notify: notified,
    now: over.now ?? (() => new Date(2026, 9, 13, 12).getTime()),
    intervalMs: 1_000_000
  })
  return { svc, sent, notified, query }
}

describe('CostAlertService', () => {
  it('sums every agent, sends the state and notifies once for the day', async () => {
    const { svc, sent, notified, query } = make()
    await svc.recheck()
    await svc.recheck()
    expect(query.mock.calls[0]![0]).toMatchObject({ profiles: [] })
    expect(query.mock.calls[0]![0].dayStarts).toHaveLength(1)
    expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, total: 12, threshold: 10, over: true, day: '2026-10-13' }))
    expect(notified).toHaveBeenCalledTimes(1)
  })

  it('notifies again on a new local day', async () => {
    let t = new Date(2026, 9, 13, 12).getTime()
    const { svc, notified } = make({ now: () => t })
    await svc.recheck()
    t = new Date(2026, 9, 14, 9).getTime()
    await svc.recheck()
    expect(notified).toHaveBeenCalledTimes(2)
  })

  it('does not notify below the threshold', async () => {
    const { svc, sent, notified } = make({ cost: 4 })
    await svc.recheck()
    expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ total: 4, over: false }))
    expect(notified).not.toHaveBeenCalled()
  })

  it('does not query while disconnected', async () => {
    const { svc, query, sent, notified } = make({ connected: false })
    await svc.recheck()
    expect(query).not.toHaveBeenCalled()
    expect(sent).not.toHaveBeenCalled()
    expect(notified).not.toHaveBeenCalled()
  })

  it('says it is off when disabled, without querying or notifying', async () => {
    const { svc, query, sent, notified } = make({ enabled: false })
    await svc.recheck()
    expect(query).not.toHaveBeenCalled()
    expect(sent).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, over: false, total: null }))
    expect(notified).not.toHaveBeenCalled()
  })

  it('never notifies after a failed check', async () => {
    const { svc, notified, query, sent } = make()
    query.mockResolvedValueOnce({ ok: false, error: 'timeout' })
    await svc.recheck()
    expect(sent).not.toHaveBeenCalled()
    expect(notified).not.toHaveBeenCalled()
  })

  it('reset forgets the notified day', async () => {
    const { svc, notified } = make()
    await svc.recheck()
    svc.reset()
    await svc.recheck()
    expect(notified).toHaveBeenCalledTimes(2)
  })

  it('runs again on the timer after start and stops cleanly', async () => {
    vi.useFakeTimers()
    try {
      const sent = vi.fn()
      const svc = new CostAlertService({
        query: async () => ok(1),
        settings: () => ({ enabled: true, usd: 10 }),
        isConnected: () => true,
        send: sent,
        notify: () => {},
        intervalMs: 1000
      })
      svc.start()
      await vi.advanceTimersByTimeAsync(2500)
      expect(sent.mock.calls.length).toBeGreaterThanOrEqual(3)
      svc.stop()
      const n = sent.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(sent.mock.calls.length).toBe(n)
    } finally {
      vi.useRealTimers()
    }
  })
})
