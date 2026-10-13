import { describe, expect, it } from 'vitest'
import type { SessionRow } from '@shared/events'
import { DEFAULT_QUERY, costLabel, durationLabel, mergeFirstPage, patchRow, rowKey, splitHighlight, statusLabel, toArgs } from '../../src/renderer/lib/sessions'

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  profile: 'default', id: 's1', title: 'T', source: 'cli', model: null, startedAt: 1000, endedAt: 1100, endReason: null,
  messageCount: 2, toolCallCount: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cost: null, costKind: null,
  parentSessionId: null, hasChildren: false, pinned: false, status: 'ended', snippet: null, ...over
})

describe('toArgs', () => {
  const now = 1_000_000
  it('maps a known agent to its profile and "all" to every profile', () => {
    expect(toArgs({ ...DEFAULT_QUERY, agent: 'scout' }, ['default', 'scout'], now).profiles).toEqual(['scout'])
    expect(toArgs({ ...DEFAULT_QUERY, agent: 'all' }, ['default', 'scout'], now).profiles).toEqual([])
  })
  it('treats an agent that no longer exists as all', () => {
    expect(toArgs({ ...DEFAULT_QUERY, agent: 'ghost' }, ['default'], now).profiles).toEqual([])
  })
  it('sets sinceTs from the range and omits source "all"', () => {
    const a = toArgs({ ...DEFAULT_QUERY, range: '7d', source: 'all' }, [], now)
    expect(a.sinceTs).toBe(now - 7 * 86400)
    expect(a.source).toBeUndefined()
    expect(toArgs({ ...DEFAULT_QUERY, range: 'all', source: 'cron' }, [], now)).toEqual({ profiles: [], source: 'cron' })
  })
})

describe('mergeFirstPage', () => {
  it('replaces the head, keeps older loaded rows and orders newest first', () => {
    const current = [row({ id: 'a', startedAt: 500 }), row({ id: 'b', startedAt: 400 }), row({ id: 'c', startedAt: 100 })]
    const fresh = [row({ id: 'n', startedAt: 600 }), row({ id: 'a', startedAt: 500, messageCount: 9 })]
    const out = mergeFirstPage(current, fresh)
    expect(out.map((r) => r.id)).toEqual(['n', 'a', 'b', 'c'])
    expect(out[1]!.messageCount).toBe(9)
  })
  it('drops a row of the head range that is no longer there', () => {
    const current = [row({ id: 'a', startedAt: 500 }), row({ id: 'gone', startedAt: 450 }), row({ id: 'c', startedAt: 100 })]
    const fresh = [row({ id: 'a', startedAt: 500 }), row({ id: 'x', startedAt: 300 })]
    expect(mergeFirstPage(current, fresh).map((r) => r.id)).toEqual(['a', 'x', 'c'])
  })
  it('keeps the current rows when the fresh page is empty', () => {
    const current = [row({ id: 'a' })]
    expect(mergeFirstPage(current, [])).toBe(current)
  })
  it('ranks rows without a start time last', () => {
    const out = mergeFirstPage([], [row({ id: 'z', startedAt: null }), row({ id: 'a', startedAt: 5 })])
    expect(out.map((r) => r.id)).toEqual(['a', 'z'])
  })
})

describe('labels', () => {
  it('shows cost with est. for estimates and a dash when unknown', () => {
    expect(costLabel(row({ cost: 0.5, costKind: 'actual' }))).toBe('$0.50')
    expect(costLabel(row({ cost: 0.02, costKind: 'estimated' }))).toBe('$0.02 est.')
    expect(costLabel(row({ cost: 0, costKind: 'actual' }))).toBe('$0.00')
    expect(costLabel(row({ cost: null, costKind: null }))).toBe('—')
  })
  it('formats durations', () => {
    expect(durationLabel(row({ startedAt: 0, endedAt: 848 }))).toBe('14m 08s')
    expect(durationLabel(row({ startedAt: 0, endedAt: 7500 }))).toBe('2h 05m')
    expect(durationLabel(row({ startedAt: 0, endedAt: 42 }))).toBe('42s')
    expect(durationLabel(row({ status: 'running', endedAt: null }))).toBe('running')
    expect(durationLabel(row({ startedAt: null, endedAt: null, status: 'ended' }))).toBe('—')
  })
  it('names statuses', () => {
    expect(statusLabel('compressed')).toBe('compressed')
    expect(statusLabel('failed')).toBe('failed')
  })
})

describe('splitHighlight', () => {
  it('splits on the marker bytes', () => {
    expect(splitHighlight('a \u0002bc\u0003 d')).toEqual([
      { text: 'a ', hit: false },
      { text: 'bc', hit: true },
      { text: ' d', hit: false }
    ])
  })
  it('returns one part without markers and survives unbalanced ones', () => {
    expect(splitHighlight('plain')).toEqual([{ text: 'plain', hit: false }])
    expect(() => splitHighlight('x \u0002 open')).not.toThrow()
    expect(splitHighlight('x \u0002 open').map((p) => p.text).join('')).toBe('x  open')
  })
})

describe('patchRow', () => {
  it('changes one row by key', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })]
    const out = patchRow(rows, rowKey(rows[1]!), { pinned: true, title: 'New' })
    expect(out[1]).toMatchObject({ pinned: true, title: 'New' })
    expect(out[0]).toBe(rows[0])
  })
})
