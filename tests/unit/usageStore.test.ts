import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CostAlertState, UsageRow, UsageSummary, UsageTools } from '@shared/events'
import { SETTINGS_DEFAULTS } from '@shared/settings'
import { useAgents } from '../../src/renderer/stores/agents'
import { useCostAlert } from '../../src/renderer/stores/costAlert'
import { useSessions } from '../../src/renderer/stores/sessions'
import { useUi } from '../../src/renderer/stores/ui'
import { useUsage } from '../../src/renderer/stores/usage'
import { loadTools, loadUsage, openToolFailure, recheckAlert, refreshUsage, reviewDayInSessions, setUsageFilter } from '../../src/renderer/usageActions'

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  day: 0, profile: 'default', provider: null, model: 'm', sessions: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, apiCalls: null, cost: 1, estimatedCost: 0, unknownCost: 0, ...over
})
const summary = (rows: UsageRow[]): UsageSummary => ({ rows, truncated: false, errors: [] })
const tools = (): UsageTools => ({ tools: [], scanned: 0, truncated: false, errors: [] })
type Args = Record<string, unknown>

beforeEach(() => {
  useUsage.getState().reset()
  useCostAlert.getState().reset()
  useSessions.getState().reset()
  useUi.setState({ settings: { ...SETTINGS_DEFAULTS }, route: 'usage' })
  useAgents.setState({ agents: [{ profile: 'default' }, { profile: 'scout' }] as never })
})
afterEach(() => vi.unstubAllGlobals())

describe('useUsage reducers', () => {
  it('stores a summary with the day starts it was asked for', () => {
    useUsage.getState().applySummary(summary([row()]), [10, 20], 5)
    expect(useUsage.getState()).toMatchObject({ status: 'ok', error: null, receivedAt: 5, dayStarts: [10, 20] })
  })
  it('pins a day (a second pin of the same day unpins) and keeps tab, sort and tool', () => {
    const s = useUsage.getState()
    s.pinDay(2)
    expect(useUsage.getState().pinnedDay).toBe(2)
    s.pinDay(2)
    expect(useUsage.getState().pinnedDay).toBeNull()
    s.setTab('tools')
    s.setSort('errors')
    s.selectTool('web_search')
    expect(useUsage.getState()).toMatchObject({ tab: 'tools', toolSort: 'errors', selectedTool: 'web_search' })
  })
  it('keeps the data when an error arrives and clears it on request', () => {
    const s = useUsage.getState()
    s.applySummary(summary([row()]), [10], 1)
    s.setError('boom')
    expect(useUsage.getState()).toMatchObject({ status: 'error', error: 'boom' })
    expect(useUsage.getState().summary).not.toBeNull()
    s.clearData()
    expect(useUsage.getState()).toMatchObject({ summary: null, tools: null, status: 'idle', pinnedDay: null })
  })
  it('applies and resets the cost alert state', () => {
    const st: CostAlertState = { enabled: true, day: '2026-10-13', total: 12, threshold: 10, over: true, checkedAt: 1 }
    useCostAlert.getState().apply(st)
    expect(useCostAlert.getState().state).toEqual(st)
    useCostAlert.getState().reset()
    expect(useCostAlert.getState().state).toBeNull()
  })
})

describe('usage actions', () => {
  it('builds the request from the shared filters', async () => {
    const summaryFn = vi.fn(async (_a: Args) => ({ ok: true, data: summary([]) }))
    vi.stubGlobal('window', { mc: { usage: { summary: summaryFn } } })
    useUi.setState({ settings: { ...SETTINGS_DEFAULTS, 'filters.agent': 'scout', 'filters.range': '14d' } })
    await loadUsage()
    const a = summaryFn.mock.calls[0]![0] as { profiles: string[]; dayStarts: number[]; endTs: number }
    expect(a.profiles).toEqual(['scout'])
    expect(a.dayStarts).toHaveLength(14)
    expect(a.endTs).toBeGreaterThan(a.dayStarts[13]!)
    useUi.setState({ settings: { ...SETTINGS_DEFAULTS, 'filters.agent': 'ghost', 'filters.range': 'today' } })
    await loadUsage()
    const b = summaryFn.mock.calls[1]![0] as { profiles: string[]; dayStarts: number[] }
    expect(b.profiles).toEqual([])
    expect(b.dayStarts).toHaveLength(7)
    useUi.setState({ settings: { ...SETTINGS_DEFAULTS, 'filters.range': 'all' } })
    await loadUsage()
    expect((summaryFn.mock.calls[2]![0] as { dayStarts: number[] }).dayStarts).toHaveLength(30)
  })

  it('drops an answer that is no longer the current one', async () => {
    let release!: (v: unknown) => void
    const slow = new Promise((r) => (release = r))
    let n = 0
    const summaryFn = vi.fn(async (_a: Args) => (++n === 1 ? slow : { ok: true, data: summary([row({ cost: 2 })]) }))
    vi.stubGlobal('window', { mc: { usage: { summary: summaryFn } } })
    const first = loadUsage()
    const second = loadUsage()
    await second
    release({ ok: true, data: summary([row({ cost: 99 })]) })
    await first
    expect(useUsage.getState().summary!.rows[0]!.cost).toBe(2)
  })

  it('keeps the data and records the error when a refresh fails', async () => {
    const summaryFn = vi.fn().mockResolvedValueOnce({ ok: true, data: summary([row()]) }).mockResolvedValueOnce({ ok: false, error: 'timeout' })
    vi.stubGlobal('window', { mc: { usage: { summary: summaryFn } } })
    await loadUsage()
    await refreshUsage()
    const s = useUsage.getState()
    expect(s.status).toBe('error')
    expect(s.summary).not.toBeNull()
    expect(s.error).toMatch(/too long/)
  })

  it('loads tools for the same window', async () => {
    const toolsFn = vi.fn(async (_a: Args) => ({ ok: true, data: tools() }))
    vi.stubGlobal('window', { mc: { usage: { tools: toolsFn } } })
    await loadTools()
    const a = toolsFn.mock.calls[0]![0] as { sinceTs: number; endTs: number; profiles: string[] }
    expect(a.endTs - a.sinceTs).toBeGreaterThanOrEqual(7 * 82800)
    expect(a.profiles).toEqual([])
    expect(useUsage.getState().toolsStatus).toBe('ok')
  })

  it('saves a filter, unpins the day and reloads', async () => {
    const set = vi.fn(async (_k: string, _v: unknown) => {})
    const summaryFn = vi.fn(async (_a: Args) => ({ ok: true, data: summary([]) }))
    vi.stubGlobal('window', { mc: { settings: { set }, usage: { summary: summaryFn } } })
    useUsage.getState().pinDay(1)
    await setUsageFilter({ range: '30d' })
    expect(set).toHaveBeenCalledWith('filters.range', '30d')
    expect(useUsage.getState().pinnedDay).toBeNull()
    expect((summaryFn.mock.calls[0]![0] as { dayStarts: number[] }).dayStarts).toHaveLength(30)
  })

  it('rechecks the alert through the main process', async () => {
    const recheck = vi.fn(async () => {})
    vi.stubGlobal('window', { mc: { alerts: { recheck } } })
    await recheckAlert()
    expect(recheck).toHaveBeenCalledTimes(1)
  })

  it('reviews a day in Sessions with the smallest range that holds it', async () => {
    const set = vi.fn(async (_k: string, _v: unknown) => {})
    vi.stubGlobal('window', { mc: { settings: { set } } })
    const now = Date.now() / 1000
    useUsage.setState({ dayStarts: [now - 9 * 86400, now - 3 * 86400, now - 100] })
    useSessions.setState({ status: 'ok' })
    reviewDayInSessions(0)
    await Promise.resolve()
    expect(set).toHaveBeenCalledWith('filters.range', '14d')
    expect(useSessions.getState().status).toBe('idle')
    expect(useUi.getState().route).toBe('sessions')
    reviewDayInSessions(1)
    expect(set).toHaveBeenLastCalledWith('filters.range', '7d')
  })

  it('opens a failing session in Sessions', async () => {
    const transcript = vi.fn(async (_a: Args) => ({ ok: false, error: 'not_found' }))
    vi.stubGlobal('window', { mc: { sessions: { transcript } } })
    openToolFailure('scout', 's-1')
    expect(useUi.getState().route).toBe('sessions')
    expect(useSessions.getState().selected).toEqual({ profile: 'scout', id: 's-1' })
  })
})
