import { describe, expect, it } from 'vitest'
import type { SessionRow } from '@shared/events'
import { NAV } from '../../src/renderer/shell/nav'
import { buildItems, normalize, scoreText, searchItems, type PaletteItem } from '../../src/renderer/lib/palette'

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  profile: 'default', id: 's1', title: 'Morning briefing', source: 'cli', model: null, startedAt: 1000, endedAt: null, endReason: null,
  messageCount: 2, toolCallCount: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cost: null, costKind: null,
  parentSessionId: null, hasChildren: false, pinned: false, status: 'running', snippet: null, ...over
})
const agents = [{ profile: 'default', displayName: 'default' }, { profile: 'scout', displayName: 'Scout' }]
const NOW = 4600

const items = (over: { sessions?: SessionRow[]; notes?: { id: string; title: string }[] } = {}): PaletteItem[] =>
  buildItems({ agents, sessions: over.sessions ?? [session()], notes: over.notes ?? [{ id: 'daily/2026-10-13.md', title: 'Daily note' }], now: NOW })

describe('normalize and scoreText', () => {
  it('lowercases and removes accents', () => {
    expect(normalize('Café  Ünï')).toBe('cafe  uni')
  })
  it('ranks exact above prefix above word prefix above substring above letters, and 0 for no match', () => {
    const s = (t: string): number => scoreText(t, 'brief')
    expect(scoreText('brief', 'brief')).toBeGreaterThan(s('briefing'))
    expect(s('briefing')).toBeGreaterThan(s('the brief one'))
    expect(s('the brief one')).toBeGreaterThan(s('rebriefed'))
    expect(s('rebriefed')).toBeGreaterThan(scoreText('b-r-i-e-x-f', 'brief'))
    expect(scoreText('b-r-i-e-x-f', 'brief')).toBeGreaterThan(0)
    expect(scoreText('nothing here', 'zq')).toBe(0)
  })
  it('ignores case and accents', () => {
    expect(scoreText('Café notes', 'CAFE')).toBeGreaterThanOrEqual(80)
  })
})

describe('buildItems', () => {
  it('has one screen item per menu entry with its shortcut and a note for screens that are not built', () => {
    const all = items()
    const screens = all.filter((i) => i.group === 'screen')
    expect(screens).toHaveLength(NAV.length)
    const sessions = screens.find((i) => i.target.kind === 'screen' && i.target.route === 'sessions')!
    expect(sessions.hint).toContain('Ctrl+4')
    for (const route of ['kanban', 'skills']) {
      expect(screens.find((i) => i.target.kind === 'screen' && i.target.route === route)!.hint).toContain('Coming in a later release')
    }
  })
  it('has a chat item and four settings items per agent', () => {
    const all = items()
    expect(all.filter((i) => i.target.kind === 'chat')).toHaveLength(2)
    const settings = all.filter((i) => i.target.kind === 'agent-settings')
    expect(settings).toHaveLength(8)
    expect(settings.map((i) => i.label)).toContain('Scout · SOUL.md')
    expect(settings.map((i) => i.label)).toContain('Scout · User profile')
  })
  it('names sessions by title or Untitled session and describes them with the agent, source and age', () => {
    const all = items({ sessions: [session(), session({ id: 's2', title: null, profile: 'scout', source: null })] })
    const named = all.find((i) => i.id === 'session:default:s1')!
    expect(named.label).toBe('Morning briefing')
    expect(named.hint).toBe('default · cli · 1h ago')
    const bare = all.find((i) => i.id === 'session:scout:s2')!
    expect(bare.label).toBe('Untitled session')
    expect(bare.hint).toContain('Scout')
  })
  it('has note items and the five actions, with unique ids', () => {
    const all = items()
    expect(all.find((i) => i.target.kind === 'note')).toMatchObject({ label: 'Daily note', hint: 'daily/2026-10-13.md' })
    expect(all.filter((i) => i.group === 'action').map((i) => i.target.kind === 'action' && i.target.action).sort()).toEqual(['connection', 'cost-today', 'cron', 'errors-hour', 'settings'])
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length)
  })
})

describe('searchItems', () => {
  it('shows screens and actions first, then a few sessions and notes, for an empty query', () => {
    const many = Array.from({ length: 9 }, (_, i) => session({ id: `s${i}`, title: `Session ${i}` }))
    const notes = Array.from({ length: 9 }, (_, i) => ({ id: `n${i}.md`, title: `Note ${i}` }))
    const out = searchItems(items({ sessions: many, notes }), '')
    expect(out.slice(0, NAV.length).every((i) => i.group === 'screen')).toBe(true)
    expect(out.filter((i) => i.group === 'session')).toHaveLength(5)
    expect(out.filter((i) => i.group === 'note')).toHaveLength(5)
    expect(out.some((i) => i.group === 'agent')).toBe(false)
  })
  it('ranks an agent by name above a session that only matches by letters', () => {
    const out = searchItems(items({ sessions: [session({ title: 'S c o u t something' })] }), 'scout')
    const labels = out.map((i) => i.label)
    expect(labels.indexOf('Scout · Model')).toBeLessThan(labels.indexOf('S c o u t something'))
    expect(labels).toContain('Chat with Scout')
  })
  it('caps sessions and notes at 8 each so they cannot push screens out', () => {
    const many = Array.from({ length: 30 }, (_, i) => session({ id: `s${i}`, title: `alpha ${i}` }))
    const out = searchItems(items({ sessions: many }), 'alpha')
    expect(out.filter((i) => i.group === 'session')).toHaveLength(8)
  })
  it('matches through keywords and ignores accents', () => {
    expect(searchItems(items(), 'budget').some((i) => i.id === 'action:cost-today')).toBe(true)
    expect(searchItems(items({ notes: [{ id: 'c.md', title: 'Café' }] }), 'cafe').some((i) => i.label === 'Café')).toBe(true)
  })
  it('respects the limit and returns nothing when nothing matches', () => {
    expect(searchItems(items(), 'e', 5)).toHaveLength(5)
    expect(searchItems(items(), 'zzzzqq')).toEqual([])
  })
})
