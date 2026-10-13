import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogFileInfo, LogsRead } from '@shared/events'
import { SETTINGS_DEFAULTS } from '@shared/settings'
import { followTick, loadApprovals, loadLogsOlder, openLogs, openLogsOnErrors, runGatewayAction, setLogFile } from '../../src/renderer/logsActions'
import { useAgents } from '../../src/renderer/stores/agents'
import { useLogs } from '../../src/renderer/stores/logs'
import { useUi } from '../../src/renderer/stores/ui'

type Args = Record<string, unknown>
const file = (name: string, profile = 'default'): LogFileInfo => ({ profile, name, size: 100, mtime: 1000 })
const read = (lines: string[], over: Partial<LogsRead> = {}): LogsRead => ({ lines, offset: 100, size: 100, mtime: 1000, startOffset: 0, more: false, reset: false, skipped: false, ...over })
const ok = <T,>(data: T) => ({ ok: true, data })

beforeEach(() => {
  useLogs.getState().reset()
  useUi.setState({ settings: { ...SETTINGS_DEFAULTS }, route: 'logs' })
  useAgents.setState({ agents: [{ profile: 'default', displayName: 'default' }, { profile: 'scout', displayName: 'Scout' }] as never })
})
afterEach(() => vi.unstubAllGlobals())

describe('useLogs reducers', () => {
  it('stores the first read, appends follow reads and keeps the newest 5,000 lines', () => {
    const s = useLogs.getState()
    s.applyInitial(read(['a', 'b'], { offset: 10, more: true }), 500)
    expect(useLogs.getState()).toMatchObject({ lines: ['a', 'b'], offset: 10, more: true, status: 'ok', limit: 500 })
    s.applyFollow(read(['c'], { offset: 12 }))
    expect(useLogs.getState().lines).toEqual(['a', 'b', 'c'])
    s.applyFollow(read(Array.from({ length: 5100 }, (_, i) => `x${i}`), { offset: 99 }))
    const st = useLogs.getState()
    expect(st.lines).toHaveLength(5000)
    expect(st.lines.at(-1)).toBe('x5099')
    expect(st.more).toBe(true)
  })
  it('counts new lines only while the reader is paused, and clears the count on resume', () => {
    const s = useLogs.getState()
    s.applyInitial(read(['a']), 500)
    s.applyFollow(read(['b']))
    expect(useLogs.getState().newLines).toBe(0)
    s.setPaused(true)
    s.applyFollow(read(['c', 'd']))
    expect(useLogs.getState().newLines).toBe(2)
    s.setPaused(false)
    expect(useLogs.getState().newLines).toBe(0)
  })
  it('replaces the lines and says so when the log was rotated', () => {
    const s = useLogs.getState()
    s.applyInitial(read(['old']), 500)
    s.applyFollow(read(['fresh'], { reset: true }))
    expect(useLogs.getState()).toMatchObject({ lines: ['fresh'], notice: 'The log was rotated.' })
  })
  it('keeps the lines when an error arrives', () => {
    const s = useLogs.getState()
    s.applyInitial(read(['a']), 500)
    s.setError('boom')
    expect(useLogs.getState()).toMatchObject({ status: 'error', error: 'boom', lines: ['a'] })
  })
})

describe('opening the logs', () => {
  it('lists the files of the agent, picks agent.log and reads its last lines', async () => {
    const list = vi.fn(async (_a: Args) => ok({ files: [file('errors.log'), file('agent.log')], errors: [] }))
    const readFn = vi.fn(async (_a: Args) => ok(read(['l1', 'l2'])))
    vi.stubGlobal('window', { mc: { logs: { list, read: readFn }, settings: { set: async () => {} } } })
    await openLogs()
    expect(list).toHaveBeenCalledWith({ profiles: ['default'] })
    expect(readFn).toHaveBeenCalledWith({ profile: 'default', file: 'agent.log', limit: 500 })
    expect(useLogs.getState()).toMatchObject({ profile: 'default', file: 'agent.log', lines: ['l1', 'l2'], status: 'ok' })
  })
  it('uses the shared agent when one is chosen and says so when there is no file', async () => {
    useUi.setState({ settings: { ...SETTINGS_DEFAULTS, 'filters.agent': 'scout' } })
    const list = vi.fn(async (_a: Args) => ok({ files: [], errors: [] }))
    vi.stubGlobal('window', { mc: { logs: { list, read: vi.fn() } } })
    await openLogs()
    expect(list).toHaveBeenCalledWith({ profiles: ['scout'] })
    expect(useLogs.getState()).toMatchObject({ profile: 'scout', file: null, files: [], lines: [], status: 'ok' })
  })
  it('opens the pending file first (the palette action) and drops a stale answer', async () => {
    useLogs.setState({ pendingFile: 'errors.log' })
    let release!: (v: unknown) => void
    const slow = new Promise((r) => (release = r))
    let n = 0
    const list = vi.fn(async (_a: Args) => (++n === 1 ? slow : ok({ files: [file('agent.log'), file('errors.log')], errors: [] })))
    const readFn = vi.fn(async (_a: Args) => ok(read(['fresh'])))
    vi.stubGlobal('window', { mc: { logs: { list, read: readFn } } })
    const first = openLogs()
    const second = openLogs()
    await second
    release(ok({ files: [file('agent.log')], errors: [] }))
    await first
    expect(useLogs.getState().file).toBe('errors.log')
    expect(useLogs.getState().pendingFile).toBeNull()
  })
  it('keeps the shown lines and records the error when the read fails', async () => {
    const list = vi.fn(async (_a: Args) => ok({ files: [file('agent.log')], errors: [] }))
    const readFn = vi.fn().mockResolvedValueOnce(ok(read(['a']))).mockResolvedValueOnce({ ok: false, error: 'timeout' })
    vi.stubGlobal('window', { mc: { logs: { list, read: readFn } } })
    await openLogs()
    await setLogFile('agent.log')
    expect(useLogs.getState().status).toBe('error')
    expect(useLogs.getState().error).toMatch(/too long/)
  })
})

describe('following and older lines', () => {
  async function opened(readFn: (a: Args) => unknown) {
    const list = vi.fn(async (_a: Args) => ok({ files: [file('agent.log')], errors: [] }))
    vi.stubGlobal('window', { mc: { logs: { list, read: readFn } } })
    await openLogs()
  }
  it('asks for the bytes after the offset and appends them', async () => {
    const readFn = vi.fn().mockResolvedValueOnce(ok(read(['a'], { offset: 50 }))).mockResolvedValueOnce(ok(read(['b'], { offset: 60 })))
    await opened(readFn)
    await followTick()
    expect(readFn.mock.calls[1]![0]).toEqual({ profile: 'default', file: 'agent.log', after: 50, limit: 500 })
    expect(useLogs.getState()).toMatchObject({ lines: ['a', 'b'], offset: 60 })
  })
  it('does nothing when Follow is off', async () => {
    const readFn = vi.fn().mockResolvedValueOnce(ok(read(['a'])))
    await opened(readFn)
    useLogs.getState().setFollowing(false)
    await followTick()
    expect(readFn).toHaveBeenCalledTimes(1)
  })
  it('reads further back with a larger limit', async () => {
    const readFn = vi.fn().mockResolvedValueOnce(ok(read(['a'], { more: true }))).mockResolvedValueOnce(ok(read(['0', 'a'], { more: false })))
    await opened(readFn)
    await loadLogsOlder()
    expect(readFn.mock.calls[1]![0]).toMatchObject({ limit: 2000 })
    expect(useLogs.getState()).toMatchObject({ lines: ['0', 'a'], more: false, limit: 2000 })
  })
})

describe('gateway, approvals and the errors shortcut', () => {
  it('sends the gateway action as data and returns the answer', async () => {
    const action = vi.fn(async (_a: Args) => ({ ok: true, output: 'stopped' }))
    vi.stubGlobal('window', { mc: { gateway: { action } } })
    expect(await runGatewayAction('stop', 'scout')).toEqual({ ok: true, output: 'stopped' })
    expect(action).toHaveBeenCalledWith({ action: 'stop', profile: 'scout' })
  })
  it('stores the approvals of an agent, or its error', async () => {
    const readFn = vi.fn().mockResolvedValueOnce({ ok: true, policy: '{"mode":"manual"}', policyError: null, suggest: 'a', suggestError: null }).mockResolvedValueOnce({ ok: false, error: 'not-connected' })
    vi.stubGlobal('window', { mc: { approvals: { read: readFn } } })
    await loadApprovals('default')
    await loadApprovals('scout')
    const a = useLogs.getState().approvals
    expect(a['default']).toMatchObject({ status: 'ok' })
    expect(a['scout']).toMatchObject({ status: 'error' })
  })
  it('opens the logs on the errors of the last hour', () => {
    const set = vi.fn(async (_k: string, _v: unknown) => {})
    vi.stubGlobal('window', { mc: { settings: { set } } })
    openLogsOnErrors()
    expect(useUi.getState().route).toBe('logs')
    expect(useUi.getState().settings['logs.levels']).toEqual(['ERROR', 'CRITICAL'])
    expect(useUi.getState().settings['logs.range']).toBe('1h')
    expect(useLogs.getState()).toMatchObject({ tab: 'logs', pendingFile: 'errors.log', component: 'all', query: '' })
  })
})
