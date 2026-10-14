import { describe, expect, it } from 'vitest'
import type { FeedKind } from '@shared/events'
import type { ChatEvent } from '@shared/ipc'
import { buildConversation, callArgs, chipText, foldEvent, formatDuration, newTurn, sessionItems, splitAttachments, type Turn } from '../../src/renderer/lib/chat'
import { sampleItem } from '../helpers/samples'

const T0 = 1_760_000_000
const item = (n: number, kind: FeedKind, text: string, over = {}) =>
  sampleItem({ id: `default:${n}:0`, messageId: n, ts: T0 + n, kind, text, sessionId: 's-1', source: 'mission-control', ...over })

describe('foldEvent', () => {
  const ev = (e: object): ChatEvent => ({ turn: 't1', profile: 'default', ...e }) as ChatEvent

  it('starts a turn and collects text, tool chips, the result and the end', () => {
    let t = foldEvent(null, ev({ kind: 'start', mode: 'stream-json' }), 5000)!
    expect(t).toMatchObject({ id: 't1', mode: 'stream-json', text: '', ended: false, startedAt: 5000 })
    t = foldEvent(t, ev({ kind: 'text', text: 'Hel' }))!
    t = foldEvent(t, ev({ kind: 'text', text: 'lo' }))!
    t = foldEvent(t, ev({ kind: 'tool', id: 'c1', name: 'web_search', state: 'running' }))!
    t = foldEvent(t, ev({ kind: 'tool', id: 'c1', name: 'web_search', state: 'ok', ms: 1200 }))!
    t = foldEvent(t, ev({ kind: 'notice', code: 'blocked', message: 'Command blocked by Hermes approval policy' }))!
    t = foldEvent(t, ev({ kind: 'result', exitCode: 0, durationMs: 1500, inputTokens: 12, outputTokens: 3 }))!
    t = foldEvent(t, ev({ kind: 'end', exitCode: 0, stopped: false }))!
    expect(t.text).toBe('Hello')
    expect(t.tools).toEqual([{ id: 'c1', name: 'web_search', state: 'ok', ms: 1200 }])
    expect(t.notice).toContain('approval policy')
    expect(t.result).toEqual({ exitCode: 0, durationMs: 1500, inputTokens: 12, outputTokens: 3 })
    expect(t).toMatchObject({ ended: true, stopped: false })
  })

  it('ignores events of another turn and keeps the same object when nothing applies', () => {
    const t = newTurn('t1', 'plain', 1)
    expect(foldEvent(t, { turn: 'other', profile: 'default', kind: 'text', text: 'x' })).toBe(t)
    expect(foldEvent(null, { turn: 't1', profile: 'default', kind: 'text', text: 'x' })).toBeNull()
  })

  it('records errors and a stopped end', () => {
    let t: Turn | null = newTurn('t1', 'stream-json', 1)
    t = foldEvent(t, ev({ kind: 'error', message: 'rate limited' }))
    t = foldEvent(t, ev({ kind: 'end', exitCode: null, stopped: true }))
    expect(t).toMatchObject({ error: 'rate limited', ended: true, stopped: true })
  })
})

describe('approvals in a turn', () => {
  const ev = (e: object): ChatEvent => ({ turn: 't1', profile: 'default', ...e }) as ChatEvent
  const ask = ev({ kind: 'approval', id: 'ap1', title: 'terminal', detail: 'rm -rf ~/x', options: [{ id: 'allow_once', name: 'Allow once', kind: 'allow' }, { id: 'reject_once', name: 'Deny', kind: 'deny' }] })

  it('adds a pending card once and settles it with the answer', () => {
    let t = foldEvent(null, ev({ kind: 'start', mode: 'acp' }), 1)!
    t = foldEvent(t, ask)!
    t = foldEvent(t, ask)!
    expect(t.approvals).toHaveLength(1)
    expect(t.approvals[0]).toMatchObject({ id: 'ap1', title: 'terminal', detail: 'rm -rf ~/x', state: 'pending' })
    t = foldEvent(t, ev({ kind: 'approval-done', id: 'ap1', outcome: 'allowed', choice: 'Allow once' }))!
    expect(t.approvals[0]).toMatchObject({ state: 'allowed', choice: 'Allow once' })
  })

  it('keeps what was asked and answered visible after the saved reply replaces the streamed one', () => {
    let t = foldEvent(null, ev({ kind: 'start', mode: 'acp' }), (T0 + 5) * 1000)!
    t = foldEvent(t, ask)!
    t = foldEvent(t, ev({ kind: 'approval-done', id: 'ap1', outcome: 'denied', choice: 'Deny' }))!
    t = foldEvent(t, ev({ kind: 'text', text: 'not allowed' }))!
    t = foldEvent(t, ev({ kind: 'end', exitCode: 0, stopped: false }))!
    const conv = buildConversation([item(1, 'user', 'danger'), item(7, 'reply', 'not allowed')], null, t)
    expect(conv.map((c) => c.kind)).toEqual(['user', 'reply', 'stream'])
    const last = conv.at(-1)!
    expect(last.kind === 'stream' && last.turn.text).toBe('')
    expect(last.kind === 'stream' && last.turn.approvals[0]!.state).toBe('denied')
  })
})

describe('splitAttachments', () => {
  it('moves the attachment lines out of the message text', () => {
    const msg = '[Attached: /home/u/hermes-uploads/atlas/20261010/report.pdf · 2.1 MB · application/pdf]\n[Attached: /home/u/x/a.txt · 12 B · text/plain]\n\nplease read'
    const s = splitAttachments(msg)
    expect(s.text).toBe('please read')
    expect(s.attachments).toEqual([
      { path: '/home/u/hermes-uploads/atlas/20261010/report.pdf', name: 'report.pdf', info: '2.1 MB · application/pdf' },
      { path: '/home/u/x/a.txt', name: 'a.txt', info: '12 B · text/plain' }
    ])
  })

  it('leaves ordinary messages alone, also when a later line looks like an attachment', () => {
    expect(splitAttachments('hello\n[Attached: /x · 1 B · text/plain]')).toEqual({ attachments: [], text: 'hello\n[Attached: /x · 1 B · text/plain]' })
    expect(splitAttachments('')).toEqual({ attachments: [], text: '' })
  })
})

describe('sessionItems', () => {
  it('merges history with live items of this session only, oldest first, without duplicates', () => {
    const history = [item(2, 'reply', 'two'), item(1, 'user', 'one')]
    const live = [item(2, 'reply', 'two'), item(3, 'user', 'three'), item(9, 'user', 'other session', { sessionId: 's-2' }), item(8, 'user', 'other agent', { profile: 'scout', id: 'scout:8:0' })]
    expect(sessionItems(history, live, 'default', 's-1').map((i) => i.text)).toEqual(['one', 'two', 'three'])
    expect(sessionItems(history, live, 'default', null)).toEqual([])
  })
})

describe('buildConversation', () => {
  it('shows user, thinking, tool with its result, and reply in order', () => {
    const items = [
      item(1, 'user', '[Attached: /h/u/f.txt · 5 B · text/plain]\n\nhello'),
      item(2, 'thinking', 'plan first'),
      { ...item(2, 'tool', 'web_search {"q": "hermes"}'), id: 'default:2:2', toolName: 'web_search' },
      { ...item(3, 'result', '3 results'), toolName: 'web_search' },
      item(4, 'reply', 'done')
    ]
    const conv = buildConversation(items, null, null)
    expect(conv.map((c) => c.kind)).toEqual(['user', 'thinking', 'tool', 'reply'])
    const user = conv[0]!
    expect(user.kind === 'user' && user.text).toBe('hello')
    expect(user.kind === 'user' && user.attachments[0]!.name).toBe('f.txt')
    const tool = conv[2]!
    expect(tool.kind === 'tool' && tool.result).toBe('3 results')
  })

  it('matches each result with the closest earlier call of the same tool', () => {
    const items = [
      { ...item(1, 'tool', 'a {}'), id: 'a', toolName: 'a' },
      { ...item(2, 'tool', 'b {}'), id: 'b', toolName: 'b' },
      { ...item(3, 'result', 'rb'), id: 'rb', toolName: 'b' },
      { ...item(4, 'result', 'ra'), id: 'ra', toolName: 'a' }
    ]
    const conv = buildConversation(items, null, null)
    expect(conv.map((c) => (c.kind === 'tool' ? [c.name, c.result] : c.kind))).toEqual([['a', 'ra'], ['b', 'rb']])
  })

  it('shows the message just sent until the server has saved it, then drops the duplicate', () => {
    const pending = { text: 'hello there', at: (T0 + 5) * 1000, attachments: [] }
    expect(buildConversation([], pending, null).map((c) => [c.kind, c.kind === 'user' && c.pending])).toEqual([['user', true]])
    const saved = [item(6, 'user', 'hello there')]
    const conv = buildConversation(saved, pending, null)
    expect(conv).toHaveLength(1)
    expect(conv[0]!.kind === 'user' && conv[0]!.pending).toBeFalsy()
    // an older identical message does not count as saved
    const older = [item(1, 'user', 'hello there', { ts: T0 - 100 })]
    expect(buildConversation(older, pending, null)).toHaveLength(2)
  })

  it('shows the reply being written, with chips until the server saves the tool step, and drops it once the reply is saved', () => {
    const running: Turn = { ...newTurn('t', 'stream-json', (T0 + 5) * 1000), text: 'Working on', tools: [{ id: 'c', name: 'web_search', state: 'running' }] }
    const live = buildConversation([], null, running)
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ kind: 'stream', showChips: true })
    const withTool = buildConversation([{ ...item(6, 'tool', 'web_search {}'), id: 'x', toolName: 'web_search' }], null, running)
    expect(withTool.at(-1)).toMatchObject({ kind: 'stream', showChips: false })
    const ended: Turn = { ...running, ended: true, text: 'All done' }
    expect(buildConversation([item(7, 'reply', 'All done')], null, ended).map((c) => c.kind)).toEqual(['reply'])
    // not saved yet: the streamed text stays visible
    expect(buildConversation([], null, ended).map((c) => c.kind)).toEqual(['stream'])
    // an old reply from before the turn does not hide it
    expect(buildConversation([item(1, 'reply', 'old')], null, ended).map((c) => c.kind)).toEqual(['reply', 'stream'])
    // nor does a reply of the previous turn that is only a second older, once the new question is saved
    const stopped: Turn = { ...newTurn('t', 'stream-json', (T0 + 5) * 1000), ended: true, stopped: true }
    const quick = [item(4, 'user', 'first'), item(5, 'reply', 'first answer'), item(6, 'user', 'slow one')]
    expect(buildConversation(quick, null, stopped).map((c) => c.kind)).toEqual(['user', 'reply', 'user', 'stream'])
  })

  it('keeps the run stats on the saved reply that replaces the streamed one', () => {
    const done: Turn = { ...newTurn('t', 'stream-json', (T0 + 5) * 1000), ended: true, text: 'All done', result: { exitCode: 0, durationMs: 1500, inputTokens: 120, outputTokens: 45 } }
    const conv = buildConversation([item(1, 'reply', 'old'), item(7, 'reply', 'All done')], null, done)
    expect(conv.map((c) => (c.kind === 'reply' ? c.stats ?? null : c.kind))).toEqual([null, '1.5s · 120 in · 45 out'])
    expect(buildConversation([item(7, 'reply', 'All done')], null, { ...done, result: { exitCode: 0 } })[0]).not.toHaveProperty('stats')
  })

  it('keeps an empty ended turn out of the way unless something happened', () => {
    const quiet: Turn = { ...newTurn('t', 'stream-json', T0 * 1000), ended: true }
    expect(buildConversation([], null, quiet)).toEqual([])
    expect(buildConversation([], null, { ...quiet, error: 'boom' })).toHaveLength(1)
    expect(buildConversation([], null, { ...quiet, stopped: true })).toHaveLength(1)
  })
})

describe('small formatters', () => {
  it('writes chips and durations', () => {
    expect(chipText({ id: 'a', name: 'web_search', state: 'running' })).toBe('web_search…')
    expect(chipText({ id: 'a', name: 'web_search', state: 'ok', ms: 1234 })).toBe('web_search ✓ 1.2s')
    expect(chipText({ id: 'a', name: 'sh', state: 'error', ms: 80 })).toBe('sh ✗ 80ms')
    expect(chipText({ id: 'a', name: 'sh', state: 'ok' })).toBe('sh ✓')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(900)).toBe('900ms')
  })

  it('compacts tool arguments and tolerates text that is not JSON', () => {
    expect(callArgs('web_search {"q": "hermes"}', 'web_search')).toBe('{"q":"hermes"}')
    expect(callArgs('shell ls -la', 'shell')).toBe('ls -la')
  })
})
