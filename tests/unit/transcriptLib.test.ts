import { describe, expect, it } from 'vitest'
import type { FeedItem } from '@shared/events'
import { buildSteps, looksFailed } from '../../src/renderer/lib/transcript'

let n = 0
const item = (over: Partial<FeedItem>): FeedItem => ({
  id: `default:${++n}:0`, profile: 'default', messageId: n, sessionId: 's1', source: 'cli', parentSessionId: null, ts: 100,
  kind: 'reply', text: '', truncated: false, fullLen: 0, toolName: null, ...over
})

describe('buildSteps', () => {
  it('pairs a tool call with its result and measures the time between them', () => {
    const call = item({ kind: 'tool', text: 'web_search {"q": "x"}', toolName: 'web_search', ts: 100 })
    const res = item({ kind: 'result', text: '3 results', toolName: 'web_search', ts: 100.84 })
    const steps = buildSteps([item({ kind: 'user', text: 'hi' }), call, res, item({ kind: 'reply', text: 'done' })])
    expect(steps.map((s) => s.kind)).toEqual(['user', 'tool', 'reply'])
    const tool = steps[1]!
    expect(tool.result).toBe(res)
    expect(tool.ms).toBe(840)
    expect(tool.name).toBe('web_search')
    expect(tool.args).toBe('{"q": "x"}')
    expect(tool.failed).toBe(false)
  })

  it('pairs calls of the same tool in order', () => {
    const c1 = item({ kind: 'tool', text: 'read {"p": 1}', toolName: 'read', ts: 1 })
    const c2 = item({ kind: 'tool', text: 'read {"p": 2}', toolName: 'read', ts: 2 })
    const r1 = item({ kind: 'result', text: 'one', toolName: 'read', ts: 3 })
    const r2 = item({ kind: 'result', text: 'two', toolName: 'read', ts: 4 })
    const steps = buildSteps([c1, c2, r1, r2])
    expect(steps[0]!.result).toBe(r1)
    expect(steps[1]!.result).toBe(r2)
  })

  it('keeps a call with no result open and a result with no call visible', () => {
    const lone = item({ kind: 'tool', text: 'x {}', toolName: 'x' })
    const orphan = item({ kind: 'result', text: 'output', toolName: 'y' })
    const steps = buildSteps([lone, orphan])
    expect(steps).toHaveLength(2)
    expect(steps[0]!.result).toBeUndefined()
    expect(steps[1]!.item).toBe(orphan)
  })

  it('never loses an item', () => {
    const items = [
      item({ kind: 'user', text: 'a' }), item({ kind: 'thinking', text: 'b' }),
      item({ kind: 'tool', text: 't {}', toolName: 't' }), item({ kind: 'result', text: 'r', toolName: 't' }),
      item({ kind: 'result', text: 'orphan', toolName: 'q' }), item({ kind: 'reply', text: 'c' })
    ]
    const seen = new Set<string>()
    for (const s of buildSteps(items)) {
      seen.add(s.item.id)
      if (s.result) seen.add(s.result.id)
    }
    expect(seen.size).toBe(items.length)
  })

  it('flags a failed result', () => {
    const steps = buildSteps([item({ kind: 'tool', text: 'x {}', toolName: 'x' }), item({ kind: 'result', text: 'Traceback (most recent call last):\n  boom', toolName: 'x' })])
    expect(steps[0]!.failed).toBe(true)
  })
})

describe('looksFailed', () => {
  it('detects common error shapes', () => {
    for (const t of ['Traceback (most recent call last)', 'Error: ENOENT', '  error: nope', '{"error": "boom"}', 'Command failed with exit code 1', 'Exception in thread']) expect(looksFailed(t), t).toBe(true)
  })
  it('does not flag ordinary output', () => {
    for (const t of ['3 results', 'no errors found', 'exit code 0', 'file saved', '']) expect(looksFailed(t), t).toBe(false)
  })
})
