import { describe, expect, it } from 'vitest'
import type { FeedItem, SessionRow } from '@shared/events'
import { exportName, toHtml, toJsonl, toMarkdown } from '../../src/renderer/lib/sessionExport'

const row: SessionRow = {
  profile: 'scout', id: 's-1', title: 'Digest <run>', source: 'cron', model: 'claude', startedAt: 1_760_000_000, endedAt: 1_760_000_060,
  endReason: 'user_exit', messageCount: 3, toolCallCount: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: null, cost: 0.5, costKind: 'actual',
  parentSessionId: null, hasChildren: false, pinned: false, status: 'ended', snippet: null
}
let n = 0
const it_ = (kind: FeedItem['kind'], text: string, toolName: string | null = null): FeedItem => ({
  id: `scout:${++n}:0`, profile: 'scout', messageId: n, sessionId: 's-1', source: 'cron', parentSessionId: null, ts: 1_760_000_000 + n,
  kind, text, truncated: false, fullLen: text.length, toolName
})
const items = [it_('user', 'run the digest'), it_('thinking', 'plan'), it_('tool', 'web_search {"q":"x"}', 'web_search'), it_('result', '3 results', 'web_search'), it_('reply', 'done <script>alert(1)</script>')]

describe('toJsonl', () => {
  it('has a session header and one line per item', () => {
    const lines = toJsonl(row, items).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(lines).toHaveLength(1 + items.length)
    expect(lines[0]).toMatchObject({ type: 'session', id: 's-1', profile: 'scout', title: 'Digest <run>' })
    expect(lines[1]).toMatchObject({ type: 'message', kind: 'user', text: 'run the digest' })
    expect(lines[3]).toMatchObject({ kind: 'tool', toolName: 'web_search' })
  })
})

describe('toMarkdown', () => {
  it('has a title, metadata and a heading per message with tool text fenced', () => {
    const md = toMarkdown(row, items)
    expect(md.startsWith('# Digest <run>\n')).toBe(true)
    expect(md).toContain('- Agent: scout')
    expect(md).toContain('### user')
    expect(md).toContain('### reply')
    expect(md).toMatch(/```\nweb_search \{"q":"x"\}\n```/)
  })
  it('fences longer than any backtick run in the text', () => {
    const md = toMarkdown(row, [it_('result', 'has ``` inside', 'x')])
    expect(md).toContain('````\nhas ``` inside\n````')
  })
})

describe('toHtml', () => {
  it('escapes titles and texts and has no raw script tag', () => {
    const html = toHtml(row, items)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Digest &lt;run&gt;')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })
})

describe('exportName', () => {
  it('uses the title when there is one, else the id, without unsafe characters', () => {
    expect(exportName(row)).toBe('Digest_run')
    expect(exportName({ ...row, title: null })).toBe('s-1')
  })
})
