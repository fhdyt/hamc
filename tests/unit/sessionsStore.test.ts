import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedItem, SessionRow, SessionsList, SessionTranscript } from '@shared/events'
import { SETTINGS_DEFAULTS } from '@shared/settings'
import { useSessions } from '../../src/renderer/stores/sessions'
import { exportSession, loadList, loadMore, openSession, refreshList, runAction, setQuery } from '../../src/renderer/sessionsActions'
import { useAgents } from '../../src/renderer/stores/agents'
import { useUi } from '../../src/renderer/stores/ui'

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  profile: 'default', id: 's1', title: 'T', source: 'cli', model: null, startedAt: 1000, endedAt: 1100, endReason: null,
  messageCount: 2, toolCallCount: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cost: null, costKind: null,
  parentSessionId: null, hasChildren: false, pinned: false, status: 'ended', snippet: null, ...over
})
const list = (rows: SessionRow[], over: Partial<SessionsList> = {}): SessionsList => ({ rows, sources: ['cli'], errors: [], more: false, fallback: null, ...over })
const item = (id: number): FeedItem => ({
  id: `default:${id}:0`, profile: 'default', messageId: id, sessionId: 's1', source: 'cli', parentSessionId: null, ts: id, kind: 'user',
  text: `m${id}`, truncated: false, fullLen: 2, toolName: null
})
const transcript = (items: FeedItem[], nextAfter: number | null): SessionTranscript => ({
  session: row(), items, nextAfter, chain: { parent: null, children: [] }, total: 5
})

beforeEach(() => {
  useSessions.getState().reset()
  useUi.setState({ settings: { ...SETTINGS_DEFAULTS } })
  useAgents.setState({ agents: [{ profile: 'default' }, { profile: 'scout' }] as never })
})
afterEach(() => vi.unstubAllGlobals())

describe('useSessions reducers', () => {
  it('replaces, appends and merges the head', () => {
    const s = useSessions.getState()
    s.applyList(list([row({ id: 'a', startedAt: 500 }), row({ id: 'b', startedAt: 400 })], { more: true, fallback: 'title' }), 'replace', 1)
    expect(useSessions.getState()).toMatchObject({ status: 'ok', more: true, fallback: 'title', receivedAt: 1, sources: ['cli'] })
    s.applyList(list([row({ id: 'c', startedAt: 300 })]), 'append', 2)
    expect(useSessions.getState().rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    s.applyList(list([row({ id: 'n', startedAt: 600 }), row({ id: 'a', startedAt: 500, messageCount: 9 })]), 'head', 3)
    expect(useSessions.getState().rows.map((r) => r.id)).toEqual(['n', 'a', 'b', 'c'])
    expect(useSessions.getState().rows[1]!.messageCount).toBe(9)
  })

  it('merges a query patch', () => {
    useSessions.getState().setQuery({ q: 'x' })
    expect(useSessions.getState().query).toMatchObject({ q: 'x', agent: 'all', range: '7d' })
  })

  it('select clears the previous transcript and applyTranscript appends pages', () => {
    const s = useSessions.getState()
    s.select({ profile: 'default', id: 's1' })
    s.applyTranscript(transcript([item(1), item(2)], 2), false)
    expect(useSessions.getState().transcript).toMatchObject({ status: 'ok', nextAfter: 2, total: 5 })
    s.applyTranscript(transcript([item(3)], null), true)
    expect(useSessions.getState().transcript.items.map((i) => i.messageId)).toEqual([1, 2, 3])
    expect(useSessions.getState().transcript.nextAfter).toBeNull()
    s.select({ profile: 'default', id: 's2' })
    expect(useSessions.getState().transcript).toMatchObject({ status: 'loading', items: [] })
  })

  it('patches a row in place and resets', () => {
    const s = useSessions.getState()
    s.applyList(list([row({ id: 'a' })]), 'replace', 1)
    s.patchRow('default:a', { pinned: true })
    expect(useSessions.getState().rows[0]!.pinned).toBe(true)
    s.reset()
    expect(useSessions.getState().rows).toEqual([])
    expect(useSessions.getState().status).toBe('idle')
  })
})

describe('session actions', () => {
  it('ignores an answer that is no longer the current one', async () => {
    let release!: (v: unknown) => void
    const slow = new Promise((r) => (release = r))
    const calls: string[] = []
    vi.stubGlobal('window', {
      mc: {
        settings: { set: async () => {} },
        sessions: {
          list: vi.fn(async () => {
            calls.push('list')
            return calls.length === 1 ? slow : { ok: true, data: list([row({ id: 'second' })]) }
          }),
          search: vi.fn()
        }
      }
    })
    const first = loadList()
    const second = loadList()
    await second
    release({ ok: true, data: list([row({ id: 'first' })]) })
    await first
    expect(useSessions.getState().rows.map((r) => r.id)).toEqual(['second'])
  })

  it('turns the agent and range filters into settings and a new query', async () => {
    const set = vi.fn(async (_k: string, _v: unknown) => {})
    const listFn = vi.fn(async (_a: Record<string, unknown>) => ({ ok: true, data: list([]) }))
    vi.stubGlobal('window', { mc: { settings: { set }, sessions: { list: listFn, search: vi.fn() } } })
    await setQuery({ agent: 'scout', range: 'today' })
    expect(set).toHaveBeenCalledWith('filters.agent', 'scout')
    expect(set).toHaveBeenCalledWith('filters.range', 'today')
    expect(listFn.mock.calls[0]![0]).toMatchObject({ profiles: ['scout'], limit: 50 })
    expect(listFn.mock.calls[0]![0].sinceTs).toBeTypeOf('number')
  })

  it('searches with the text when there is one and pages with the last row otherwise', async () => {
    const search = vi.fn(async (_a: Record<string, unknown>) => ({ ok: true, data: list([row({ id: 'hit', snippet: 'a \u0002b\u0003' })]) }))
    const listFn = vi.fn(async (_a: Record<string, unknown>) => ({ ok: true, data: list([row({ id: 'a', startedAt: 500 })], { more: true }) }))
    vi.stubGlobal('window', { mc: { settings: { set: async () => {} }, sessions: { list: listFn, search } } })
    await setQuery({ q: ' digest ' })
    expect(search.mock.calls[0]![0]).toMatchObject({ q: 'digest', limit: 200 })
    await setQuery({ q: '' })
    await loadMore()
    expect(listFn.mock.calls.at(-1)![0].before).toEqual({ ts: 500, id: 'a' })
  })

  it('keeps the rows and records the error when a refresh fails', async () => {
    const ok = { ok: true, data: list([row({ id: 'a' })]) }
    const listFn = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce({ ok: false, error: 'timeout' })
    vi.stubGlobal('window', { mc: { settings: { set: async () => {} }, sessions: { list: listFn, search: vi.fn() } } })
    await loadList()
    await refreshList()
    const s = useSessions.getState()
    expect(s.status).toBe('error')
    expect(s.rows).toHaveLength(1)
    expect(s.error).toMatch(/too long/)
  })

  it('opens a session and loads it', async () => {
    const t = vi.fn(async (_a: Record<string, unknown>) => ({ ok: true, data: transcript([item(1)], null) }))
    vi.stubGlobal('window', { mc: { sessions: { transcript: t } } })
    await openSession('default', 's1')
    expect(t).toHaveBeenCalledWith({ profile: 'default', sessionId: 's1', limit: 200 })
    expect(useSessions.getState().transcript.status).toBe('ok')
  })

  it('runs an action, patches the row and reports the CLI failure otherwise', async () => {
    useSessions.getState().applyList(list([row({ id: 'a' })]), 'replace', 1)
    const action = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'failed', detail: 'no such session' })
    vi.stubGlobal('window', { mc: { settings: { set: async () => {} }, sessions: { action, list: vi.fn(async () => ({ ok: true, data: list([row({ id: 'a', pinned: true })]) })), search: vi.fn() } } })
    const r = row({ id: 'a' })
    expect(await runAction('pin', r)).toEqual({ ok: true })
    expect(useSessions.getState().rows[0]!.pinned).toBe(true)
    expect(await runAction('rename', r, 'Nope')).toEqual({ ok: false, error: 'failed', detail: 'no such session' })
    expect(action).toHaveBeenNthCalledWith(1, { action: 'pin', profile: 'default', sessionId: 'a' })
  })

  it('exports every page of the transcript through the main process', async () => {
    const pages = [transcript([item(1), item(2)], 2), transcript([item(3)], null)]
    const t = vi.fn(async (_a: Record<string, unknown>) => ({ ok: true, data: pages.shift()! }))
    const save = vi.fn(async (_a: Record<string, unknown>) => ({ saved: 'C:/x.md' }))
    vi.stubGlobal('window', { mc: { sessions: { transcript: t, export: save } } })
    const r = await exportSession(row({ title: 'My run' }), 'md')
    expect(r).toEqual({ result: { saved: 'C:/x.md' }, truncated: false })
    expect(t).toHaveBeenCalledTimes(2)
    expect(t.mock.calls[1]![0]).toMatchObject({ afterId: 2 })
    const sent = save.mock.calls[0]![0] as unknown as { name: string; ext: string; content: string }
    expect(sent).toMatchObject({ name: 'My_run', ext: 'md' })
    expect(sent.content).toContain('m3')
  })
})
