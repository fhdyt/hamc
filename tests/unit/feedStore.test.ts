import { beforeEach, describe, expect, it } from 'vitest'
import {
  FEED_CAP,
  clock,
  clockWithDay,
  compareFeed,
  filterFeed,
  formatCost,
  formatTokens,
  isLong,
  mergeFeed,
  oldestPerProfile,
  sourceOf,
  sourcesOf,
  toggled,
  toolPreview,
  DEFAULT_FILTER
} from '../../src/renderer/lib/feed'
import { useFeed } from '../../src/renderer/stores/feed'
import { sampleFeed, sampleItem } from '../helpers/samples'

const it_ = (id: string, ts: number, over = {}) => {
  const [profile, mid] = id.split(':')
  return sampleItem({ id, profile: profile!, messageId: Number(mid), ts, ...over })
}

describe('compareFeed', () => {
  it('puts the newest first, then orders by message and position within a message', () => {
    const list = [it_('default:1:0', 10), it_('default:2:0', 20), it_('default:3:0', 20), it_('default:3:2', 20), it_('default:3:1', 20)]
    expect(list.sort(compareFeed).map((i) => i.id)).toEqual(['default:3:2', 'default:3:1', 'default:3:0', 'default:2:0', 'default:1:0'])
  })
})

describe('mergeFeed', () => {
  it('drops duplicates and reports how many items were new', () => {
    const a = [it_('default:1:0', 10)]
    const r = mergeFeed(a, [it_('default:1:0', 10), it_('default:2:0', 20), it_('default:2:0', 20)])
    expect(r.added).toBe(1)
    expect(r.items.map((i) => i.id)).toEqual(['default:2:0', 'default:1:0'])
  })

  it('returns the same array when nothing is new', () => {
    const a = [it_('default:1:0', 10)]
    expect(mergeFeed(a, [it_('default:1:0', 10)]).items).toBe(a)
    expect(mergeFeed(a, []).items).toBe(a)
  })

  it('keeps the newest items when the cap is exceeded', () => {
    const many = Array.from({ length: 12 }, (_, i) => it_(`default:${i + 1}:0`, i + 1))
    const r = mergeFeed([], many, 5)
    expect(r.items.map((i) => i.messageId)).toEqual([12, 11, 10, 9, 8])
    expect(FEED_CAP).toBe(5000)
  })

  it('interleaves older history in the right place', () => {
    const cur = [it_('default:5:0', 50), it_('default:2:0', 20)]
    expect(mergeFeed(cur, [it_('scout:3:0', 30)]).items.map((i) => i.id)).toEqual(['default:5:0', 'scout:3:0', 'default:2:0'])
  })
})

describe('oldestPerProfile', () => {
  it('finds the lowest message id for each profile', () => {
    expect(oldestPerProfile([it_('default:9:0', 9), it_('default:4:1', 4), it_('scout:7:0', 7)])).toEqual({ default: 4, scout: 7 })
    expect(oldestPerProfile([])).toEqual({})
  })
})

describe('filterFeed', () => {
  const items = sampleFeed().items
  it('returns the same list when no filter is set', () => {
    expect(filterFeed(items, DEFAULT_FILTER)).toBe(items)
  })
  it('hides agents, kinds and sources', () => {
    expect(filterFeed(items, { ...DEFAULT_FILTER, hiddenAgents: ['scout'] }).every((i) => i.profile === 'default')).toBe(true)
    expect(filterFeed(items, { ...DEFAULT_FILTER, hiddenKinds: ['result', 'thinking'] }).map((i) => i.kind)).not.toContain('result')
    expect(filterFeed(items, { ...DEFAULT_FILTER, hiddenSources: ['cron'] }).map((i) => i.profile)).not.toContain('scout')
  })
  it('searches text and tool name, ignoring case', () => {
    expect(filterFeed(items, { ...DEFAULT_FILTER, query: ' DIGEST ' }).map((i) => i.id)).toEqual(['scout:5:1'])
    expect(filterFeed(items, { ...DEFAULT_FILTER, query: 'web_search' }).map((i) => i.kind)).toEqual(['tool', 'result'])
  })
})

describe('small helpers', () => {
  it('names the source, falling back to subagent for children', () => {
    expect(sourceOf({ source: 'telegram', parentSessionId: null })).toBe('telegram')
    expect(sourceOf({ source: null, parentSessionId: 'p' })).toBe('subagent')
    expect(sourceOf({ source: null, parentSessionId: null })).toBe('unknown')
    expect(sourcesOf(sampleFeed().items)).toEqual(['cron', 'telegram'])
  })
  it('toggles list membership without mutating', () => {
    const a = ['x']
    expect(toggled(a, 'y')).toEqual(['x', 'y'])
    expect(toggled(a, 'x')).toEqual([])
    expect(a).toEqual(['x'])
  })
  it('formats clock times', () => {
    const ts = new Date(2026, 9, 11, 7, 5, 9).getTime() / 1000
    expect(clock(ts)).toBe('07:05:09')
    expect(clockWithDay(ts, new Date(2026, 9, 11, 20).getTime())).toBe('07:05:09')
    expect(clockWithDay(ts, new Date(2026, 9, 14, 20).getTime())).toContain('07:05:09')
    expect(clockWithDay(ts, new Date(2026, 9, 14, 20).getTime())).toContain('·')
  })
  it('makes tool arguments compact and tolerates non-JSON', () => {
    expect(toolPreview('{ "a": 1,\n "b": [1, 2] }')).toBe('{"a":1,"b":[1,2]}')
    expect(toolPreview('not json')).toBe('not json')
  })
  it('detects long text', () => {
    expect(isLong({ text: 'short' })).toBe(false)
    expect(isLong({ text: 'x'.repeat(400) })).toBe(true)
    expect(isLong({ text: 'a\nb\nc\nd\ne\nf\ng' })).toBe(true)
  })
  it('formats tokens and cost', () => {
    expect([formatTokens(999), formatTokens(1500), formatTokens(25_000), formatTokens(2_400_000)]).toEqual(['999', '1.5k', '25k', '2.4M'])
    expect([formatCost(0), formatCost(0.004), formatCost(1.2345)]).toEqual(['$0', '<$0.01', '$1.23'])
  })
})

describe('useFeed', () => {
  beforeEach(() => useFeed.getState().reset())

  it('stores history without counting it as unseen', () => {
    useFeed.getState().setAtTop(false)
    useFeed.getState().applyFeed(sampleFeed())
    expect(useFeed.getState().items).toHaveLength(5)
    expect(useFeed.getState().unseen).toBe(0)
    expect(useFeed.getState().receivedAt).not.toBeNull()
  })

  it('counts new items as unseen only while the reader is away from the top', () => {
    const s = useFeed.getState()
    s.applyFeed(sampleFeed())
    s.applyFeed({ items: [it_('default:6:0', 2_000_000_000)], cursors: { default: 6 }, history: false })
    expect(useFeed.getState().unseen).toBe(0)
    s.setAtTop(false)
    s.applyFeed({ items: [it_('default:7:0', 2_000_000_001), it_('default:7:0', 2_000_000_001)], cursors: { default: 7 }, history: false })
    expect(useFeed.getState().unseen).toBe(1)
    s.setAtTop(true)
    expect(useFeed.getState().unseen).toBe(0)
  })

  it('merges older history and remembers exhausted profiles', () => {
    const s = useFeed.getState()
    s.applyFeed(sampleFeed())
    s.setLoadingOlder(true)
    s.mergeOlder([it_('default:1:0', 1)], { default: true })
    const now = useFeed.getState()
    expect(now.items.at(-1)!.id).toBe('default:1:0')
    expect(now.exhausted).toEqual({ default: true })
    expect(now.loadingOlder).toBe(false)
  })

  it('edits filters', () => {
    const s = useFeed.getState()
    s.toggleAgent('scout')
    s.toggleKind('result')
    s.toggleSource('cron')
    s.setFilter({ query: 'x' })
    expect(useFeed.getState().filter).toEqual({ hiddenAgents: ['scout'], hiddenKinds: ['result'], hiddenSources: ['cron'], query: 'x' })
    s.soloAgent('default', ['default', 'scout', 'atlas'])
    expect(useFeed.getState().filter.hiddenAgents).toEqual(['scout', 'atlas'])
    s.resetFilter()
    expect(useFeed.getState().filter).toEqual(DEFAULT_FILTER)
  })

  it('opens and closes the modal and the session view, and resets everything', () => {
    const s = useFeed.getState()
    s.openModal()
    s.openSession('scout', 's1')
    expect(useFeed.getState().modalOpen).toBe(true)
    expect(useFeed.getState().session).toEqual({ profile: 'scout', sessionId: 's1' })
    s.closeSession()
    s.closeModal()
    expect(useFeed.getState().session).toBeNull()
    s.applyFeed(sampleFeed())
    s.reset()
    expect(useFeed.getState().items).toEqual([])
  })
})
