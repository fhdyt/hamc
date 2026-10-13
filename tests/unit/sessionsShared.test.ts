import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '@shared/settings'
import { SessionRow, SessionsList, SessionTranscript } from '@shared/events'
import { sessionCommandArgs, sessionCommandPreview, sinceFor, validTitle } from '@shared/sessions'

const row = {
  profile: 'default', id: 's1', title: null, source: 'cli', model: null, startedAt: 1, endedAt: null, endReason: null,
  messageCount: 2, toolCallCount: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cost: null, costKind: null,
  parentSessionId: null, hasChildren: false, pinned: false, status: 'running', snippet: null
}

describe('title rules', () => {
  it('trims and accepts 1 to 80 characters', () => {
    expect(validTitle('  Morning briefing ')).toBe('Morning briefing')
    expect(validTitle('x'.repeat(80))).toBe('x'.repeat(80))
  })
  it('rejects empty, too long and control characters', () => {
    expect(validTitle('   ')).toBeNull()
    expect(validTitle('x'.repeat(81))).toBeNull()
    expect(validTitle('a\nb')).toBeNull()
    expect(validTitle('a\u0000b')).toBeNull()
  })
})

describe('command helpers', () => {
  it('builds argv without hermes, with -p for non default profiles', () => {
    expect(sessionCommandArgs('pin', 'default', 's1')).toEqual(['sessions', 'pin', 's1'])
    expect(sessionCommandArgs('unpin', 'scout', 's1')).toEqual(['-p', 'scout', 'sessions', 'unpin', 's1'])
    expect(sessionCommandArgs('rename', 'scout', 's1', 'New title')).toEqual(['-p', 'scout', 'sessions', 'rename', 's1', 'New title'])
  })
  it('previews the exact command, quoting the title', () => {
    expect(sessionCommandPreview('rename', 'scout', 's1', 'He said "hi"')).toBe('$ hermes -p scout sessions rename s1 "He said \\"hi\\""')
    expect(sessionCommandPreview('pin', 'default', 's1')).toBe('$ hermes sessions pin s1')
  })
})

describe('range', () => {
  const now = new Date(2026, 9, 13, 15, 30).getTime() / 1000
  it('maps ranges to a since timestamp', () => {
    expect(sinceFor('all', now)).toBeUndefined()
    expect(sinceFor('7d', now)).toBe(now - 7 * 86400)
    expect(sinceFor('30d', now)).toBe(now - 30 * 86400)
    expect(sinceFor('today', now)).toBe(new Date(2026, 9, 13).getTime() / 1000)
  })
})

describe('schemas', () => {
  it('parse a row, a list and a transcript', () => {
    expect(SessionRow.parse(row).status).toBe('running')
    expect(SessionsList.parse({ rows: [row], sources: ['cli'], errors: [], more: false, fallback: null }).rows).toHaveLength(1)
    expect(SessionTranscript.parse({ session: row, items: [], nextAfter: null, chain: { parent: null, children: [] }, total: 2 }).total).toBe(2)
  })
  it('settings have the shared filters', () => {
    expect(SETTINGS_DEFAULTS['filters.agent']).toBe('all')
    expect(SETTINGS_DEFAULTS['filters.range']).toBe('7d')
    expect(SETTINGS_SCHEMA['filters.range'].safeParse('year').success).toBe(false)
    expect(SETTINGS_SCHEMA['filters.agent'].safeParse('scout').success).toBe(true)
  })
})
