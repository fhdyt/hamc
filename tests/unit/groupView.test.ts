import { beforeEach, describe, expect, it } from 'vitest'
import type { GroupEntry, GroupEvent, GroupRoom } from '@shared/groups'
import type { ChatEvent } from '@shared/ipc'
import { buildGroupConv, insertMention, mentionAt, quietText, roomSub, suggest } from '../../src/renderer/lib/groupView'
import { isViewing, roomKey } from '../../src/renderer/lib/unread'
import { addEntry, useGroups } from '../../src/renderer/stores/groups'

const entry = (seq: number, author: string, text: string, status: GroupEntry['status'] = 'ok'): GroupEntry => ({ seq, author, text, status, ts: seq })
const room: GroupRoom = { id: 'mc-aaaaaaaaaa', name: 'Ops', members: ['ada', 'bo'], needsYou: false, createdAt: 1, updatedAt: 1, last: null }

describe('room conversation', () => {
  it('shows replies, folds passes and notes failures and the end of a run', () => {
    const conv = buildGroupConv([entry(1, 'user', 'hi'), entry(2, 'ada', 'hello'), entry(3, 'bo', '(pass)', 'pass'), entry(4, 'ada', '(pass)', 'pass'), entry(5, 'bo', 'no session', 'failed')], null, { reason: 'settled' }, false)
    expect(conv.map((c) => c.kind)).toEqual(['user', 'member', 'quiet', 'failed', 'end'])
    expect(conv[2]).toMatchObject({ profiles: ['bo', 'ada'] })
    expect(buildGroupConv([entry(1, 'user', 'hi')], null, { reason: 'cap' }, true).map((c) => c.kind)).toEqual(['user'])
    expect(quietText(['Ada'])).toBe('Ada passed')
    expect(quietText(['Ada', 'Bo', 'Cy'])).toBe('Ada, Bo and Cy passed')
  })

  it('suggests members after @ and puts the handle in', () => {
    expect(mentionAt('hi @re', 6)).toEqual({ start: 3, query: 're' })
    expect(mentionAt('mail a@b', 8)).toBeNull()
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
    const members = [{ profile: 'ada', name: 'Ada' }, { profile: 'bo', name: 'Research Buddy' }]
    expect(suggest('re', members).map((s) => s.handle)).toEqual(['bo'])
    expect(suggest('', members).map((s) => s.handle)).toEqual(['ada', 'bo', 'everyone'])
    expect(insertMention('hi @re and', { start: 3, query: 're' }, 'bo')).toEqual({ text: 'hi @bo  and', caret: 7 })
  })

  it('says what a room is doing', () => {
    expect(roomSub(room, true, 0)).toBe('working…')
    expect(roomSub({ ...room, needsYou: true }, false, 2)).toBe('needs you')
    expect(roomSub(room, false, 2)).toBe('2 new replies')
    expect(roomSub(room, false, 0)).toBe('2 agents')
  })

  it('knows when a room is on screen', () => {
    const base = { route: 'chat' as const, chatCurrent: 'ada', agentSelected: null, visible: true, focused: true }
    expect(isViewing({ ...base, roomCurrent: room.id }, roomKey(room.id))).toBe(true)
    // with a room open, the agent chat behind it is not on screen
    expect(isViewing({ ...base, roomCurrent: room.id }, 'ada')).toBe(false)
    expect(isViewing(base, 'ada')).toBe(true)
    expect(isViewing({ ...base, roomCurrent: room.id, focused: false }, roomKey(room.id))).toBe(false)
  })
})

describe('useGroups', () => {
  beforeEach(() => useGroups.getState().reset())
  const ev = (e: object): GroupEvent => ({ groupId: room.id, ...e }) as GroupEvent
  const chat = (e: object): ChatEvent => ({ turn: 't1', profile: 'ada', ...e }) as ChatEvent

  it('follows a run: live turn, entries and the end', () => {
    const s = useGroups.getState()
    s.setList({ rooms: [room], running: [], gateway: { ok: true } })
    s.setEntries(room.id, [entry(1, 'user', 'hi')])
    s.apply(ev({ kind: 'run-start' }))
    s.apply(ev({ kind: 'turn-start', profile: 'ada', turn: 't1' }), 10)
    s.apply(ev({ kind: 'turn', event: chat({ kind: 'text', text: 'Hel' }) }))
    s.apply(ev({ kind: 'turn', event: chat({ kind: 'text', text: 'lo', turn: 'other' }) }))
    expect(useGroups.getState().live[room.id]?.turn.text).toBe('Hel')
    expect(useGroups.getState().running[room.id]).toBe(true)
    s.apply(ev({ kind: 'entry', entry: entry(2, 'ada', 'Hello') }))
    s.apply(ev({ kind: 'entry', entry: entry(2, 'ada', 'Hello') }))
    s.apply(ev({ kind: 'turn-end', profile: 'ada', turn: 't1' }))
    s.apply(ev({ kind: 'run-end', reason: 'settled', replies: 1, needsYou: 'ada' }))
    const st = useGroups.getState()
    expect(st.entries[room.id]!.map((e) => e.seq)).toEqual([1, 2])
    expect(st.live[room.id]).toBeNull()
    expect(st.running[room.id]).toBeUndefined()
    expect(st.ended[room.id]).toEqual({ reason: 'settled', replies: 1 })
    expect(st.rooms[0]!.needsYou).toBe(true)
  })

  it('drops the open room when it is gone, and keeps entries in order', () => {
    const s = useGroups.getState()
    s.setList({ rooms: [room], running: [room.id], gateway: { ok: false, reason: 'off' } })
    s.setCurrent(room.id)
    expect(useGroups.getState()).toMatchObject({ running: { [room.id]: true }, gateway: { ok: false } })
    s.setList({ rooms: [], running: [], gateway: { ok: true } })
    expect(useGroups.getState().current).toBeNull()
    expect(addEntry([entry(1, 'user', 'a'), entry(3, 'ada', 'c')], entry(2, 'bo', 'b')).map((e) => e.seq)).toEqual([1, 2, 3])
  })
})
