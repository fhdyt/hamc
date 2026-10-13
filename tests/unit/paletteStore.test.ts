import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRow } from '@shared/events'
import { SETTINGS_DEFAULTS } from '@shared/settings'
import type { PaletteItem } from '../../src/renderer/lib/palette'
import { closePalette, countIfAway, loadPaletteSessions, openPalette, runItem, togglePalette } from '../../src/renderer/paletteActions'
import { useAgentCfg } from '../../src/renderer/stores/agentCfg'
import { useAgents } from '../../src/renderer/stores/agents'
import { useBrain } from '../../src/renderer/stores/brain'
import { useChat } from '../../src/renderer/stores/chat'
import { useCron } from '../../src/renderer/stores/cron'
import { usePalette } from '../../src/renderer/stores/palette'
import { useSessions } from '../../src/renderer/stores/sessions'
import { useUi } from '../../src/renderer/stores/ui'
import { useUnread } from '../../src/renderer/stores/unread'
import { useUsage } from '../../src/renderer/stores/usage'

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  profile: 'default', id: 's1', title: 'T', source: 'cli', model: null, startedAt: 1000, endedAt: null, endReason: null, messageCount: 1,
  toolCallCount: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cost: null, costKind: null, parentSessionId: null,
  hasChildren: false, pinned: false, status: 'running', snippet: null, ...over
})
const list = (rows: SessionRow[]) => ({ ok: true, data: { rows, sources: [], errors: [], more: false, fallback: null } })
type Args = Record<string, unknown>
const item = (target: PaletteItem['target']): PaletteItem => ({ id: 'x', group: 'screen', label: 'x', target })

beforeEach(() => {
  usePalette.getState().reset()
  useUnread.getState().reset()
  useUsage.getState().reset()
  useSessions.getState().reset()
  useChat.getState().reset()
  useAgents.setState({ agents: [{ profile: 'default' }, { profile: 'scout' }] as never, selected: null })
  useUi.setState({ settings: { ...SETTINGS_DEFAULTS }, route: 'usage', settingsTab: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('usePalette', () => {
  it('resets the highlighted row when the text changes', () => {
    const s = usePalette.getState()
    s.setIndex(3)
    s.setQuery('abc')
    expect(usePalette.getState()).toMatchObject({ query: 'abc', index: 0 })
  })
  it('opens and closes through the actions', () => {
    vi.stubGlobal('window', { mc: { sessions: { list: vi.fn(async () => list([])) } } })
    openPalette()
    expect(usePalette.getState().open).toBe(true)
    closePalette()
    expect(usePalette.getState().open).toBe(false)
    togglePalette()
    expect(usePalette.getState().open).toBe(true)
    togglePalette()
    expect(usePalette.getState().open).toBe(false)
  })
})

describe('loadPaletteSessions', () => {
  it('asks for the 100 newest sessions of every agent and stores them', async () => {
    const listFn = vi.fn(async (_a: Args) => list([row({ id: 'a' })]))
    vi.stubGlobal('window', { mc: { sessions: { list: listFn } } })
    await loadPaletteSessions()
    expect(listFn).toHaveBeenCalledWith({ profiles: [], limit: 100 })
    expect(usePalette.getState().sessions.map((r) => r.id)).toEqual(['a'])
    expect(usePalette.getState().loading).toBe(false)
  })
  it('does not ask again within 60 seconds unless forced', async () => {
    const listFn = vi.fn(async (_a: Args) => list([]))
    vi.stubGlobal('window', { mc: { sessions: { list: listFn } } })
    await loadPaletteSessions()
    await loadPaletteSessions()
    expect(listFn).toHaveBeenCalledTimes(1)
    await loadPaletteSessions(true)
    expect(listFn).toHaveBeenCalledTimes(2)
    usePalette.setState({ loadedAt: Date.now() - 61_000 })
    await loadPaletteSessions()
    expect(listFn).toHaveBeenCalledTimes(3)
  })
  it('drops an answer that is no longer the current one', async () => {
    let release!: (v: unknown) => void
    const slow = new Promise((r) => (release = r))
    let n = 0
    const listFn = vi.fn(async (_a: Args) => (++n === 1 ? slow : list([row({ id: 'second' })])))
    vi.stubGlobal('window', { mc: { sessions: { list: listFn } } })
    const first = loadPaletteSessions(true)
    const second = loadPaletteSessions(true)
    await second
    release(list([row({ id: 'first' })]))
    await first
    expect(usePalette.getState().sessions.map((r) => r.id)).toEqual(['second'])
  })
  it('keeps the old rows and records the error when the load fails', async () => {
    const listFn = vi.fn().mockResolvedValueOnce(list([row({ id: 'a' })])).mockResolvedValueOnce({ ok: false, error: 'timeout' })
    vi.stubGlobal('window', { mc: { sessions: { list: listFn } } })
    await loadPaletteSessions()
    await loadPaletteSessions(true)
    expect(usePalette.getState().sessions).toHaveLength(1)
    expect(usePalette.getState().error).toMatch(/too long/)
  })
})

describe('runItem', () => {
  it('goes to a screen and closes the palette', () => {
    usePalette.getState().setOpen(true)
    runItem(item({ kind: 'screen', route: 'sessions' }))
    expect(useUi.getState().route).toBe('sessions')
    expect(usePalette.getState().open).toBe(false)
  })
  it('opens the chat with an agent', () => {
    runItem(item({ kind: 'chat', profile: 'scout' }))
    expect(useUi.getState().route).toBe('chat')
    expect(useChat.getState().current).toBe('scout')
    expect(useAgents.getState().selected).toBe('scout')
  })
  it('opens the settings of an agent on the chosen tab', () => {
    runItem(item({ kind: 'agent-settings', profile: 'scout', tab: 'memory' }))
    expect(useUi.getState().settingsTab).toBe('agents')
    expect(useAgentCfg.getState().profile).toBe('scout')
    expect(useAgentCfg.getState().tab).toBe('memory')
  })
  it('opens a session in Sessions', () => {
    vi.stubGlobal('window', { mc: { sessions: { transcript: vi.fn(async () => ({ ok: false, error: 'not_found' })) } } })
    runItem(item({ kind: 'session', profile: 'scout', id: 's-9' }))
    expect(useUi.getState().route).toBe('sessions')
    expect(useSessions.getState().selected).toEqual({ profile: 'scout', id: 's-9' })
  })
  it('opens a note', () => {
    runItem(item({ kind: 'note', id: 'daily/a.md' }))
    expect(useBrain.getState().noteModal).toBe('daily/a.md')
  })
  it('runs the actions', () => {
    runItem(item({ kind: 'action', action: 'settings' }))
    expect(useUi.getState().settingsTab).toBe('general')
    runItem(item({ kind: 'action', action: 'connection' }))
    expect(useUi.getState().settingsTab).toBe('connection')
    runItem(item({ kind: 'action', action: 'cron' }))
    expect(useUi.getState().route).toBe('dashboard')
    expect(useCron.getState().modalOpen).toBe(true)
    vi.stubGlobal('window', { mc: { settings: { set: async () => {} } } })
    runItem(item({ kind: 'action', action: 'errors-hour' }))
    expect(useUi.getState().route).toBe('logs')
    expect(useUi.getState().settings['logs.levels']).toEqual(['ERROR', 'CRITICAL'])
    runItem(item({ kind: 'action', action: 'cost-today' }))
    expect(useUi.getState().route).toBe('usage')
    expect(useUsage.getState()).toMatchObject({ tab: 'cost', pinToday: true })
  })
})

describe('today pin', () => {
  it('pins the last day at once when there are day starts, and when the data arrives otherwise', () => {
    useUsage.setState({ dayStarts: [1, 2, 3] })
    useUsage.getState().requestPinToday()
    expect(useUsage.getState()).toMatchObject({ pinnedDay: 2, pinToday: false })
    useUsage.getState().reset()
    useUsage.getState().requestPinToday()
    expect(useUsage.getState().pinToday).toBe(true)
    useUsage.getState().applySummary({ rows: [], truncated: false, errors: [] }, [10, 20])
    expect(useUsage.getState()).toMatchObject({ pinnedDay: 1, pinToday: false })
  })
})

describe('countIfAway', () => {
  const doc = (visible: boolean, focused: boolean) => vi.stubGlobal('document', { visibilityState: visible ? 'visible' : 'hidden', hasFocus: () => focused })
  it('counts when the agent is not on screen and not when it is', () => {
    doc(true, true)
    useUi.setState({ route: 'usage' })
    countIfAway('scout')
    expect(useUnread.getState().counts).toEqual({ scout: 1 })
    useUi.setState({ route: 'chat' })
    useChat.getState().setCurrent('scout')
    countIfAway('scout')
    expect(useUnread.getState().counts).toEqual({ scout: 1 })
  })
  it('counts when the window is not focused or hidden', () => {
    useUi.setState({ route: 'chat' })
    useChat.getState().setCurrent('scout')
    doc(true, false)
    countIfAway('scout')
    doc(false, true)
    countIfAway('scout')
    expect(useUnread.getState().counts).toEqual({ scout: 2 })
  })
})
