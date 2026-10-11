import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatEvent } from '@shared/ipc'
import { emptyRoom, isBusy, useChat } from '../../src/renderer/stores/chat'

const ev = (e: object, profile = 'default'): ChatEvent => ({ turn: 't1', profile, ...e }) as ChatEvent

beforeEach(() => useChat.getState().reset())

describe('useChat', () => {
  it('builds a room per agent from the events of a turn', () => {
    const s = useChat.getState()
    s.patch('default', () => ({ sending: true, sendError: 'old' }))
    s.applyChat(ev({ kind: 'start', mode: 'stream-json' }), 1000)
    expect(useChat.getState().rooms['default']).toMatchObject({ sending: false, sendError: null })
    s.applyChat(ev({ kind: 'session', sessionId: 's-1' }))
    s.applyChat(ev({ kind: 'text', text: 'Hi' }))
    s.applyChat(ev({ kind: 'tool', id: 'c', name: 'web_search', state: 'running' }))
    const room = useChat.getState().rooms['default']!
    expect(room.sessionId).toBe('s-1')
    expect(room.loaded).toBe(true)
    expect(room.turn).toMatchObject({ text: 'Hi', ended: false })
    expect(isBusy(room)).toBe(true)
    s.applyChat(ev({ kind: 'end', exitCode: 0, stopped: false }))
    expect(isBusy(useChat.getState().rooms['default'])).toBe(false)
    expect(useChat.getState().rooms['scout']).toBeUndefined()
  })

  it('keeps agents apart and ignores events of an old turn', () => {
    const s = useChat.getState()
    s.applyChat(ev({ kind: 'start', mode: 'stream-json' }, 'scout'), 1)
    s.applyChat({ turn: 'other', profile: 'scout', kind: 'text', text: 'x' })
    expect(useChat.getState().rooms['scout']!.turn!.text).toBe('')
    expect(useChat.getState().rooms['default']).toBeUndefined()
  })

  it('is busy while sending, before the turn exists', () => {
    expect(isBusy(undefined)).toBe(false)
    expect(isBusy({ ...emptyRoom(), sending: true })).toBe(true)
  })

  it('follows the progress of an uploading file in whichever room holds it', () => {
    const s = useChat.getState()
    s.patch('default', () => ({ files: [{ id: 'f1', name: 'a.txt', size: 10, mime: 'text/plain', state: 'ready', sent: 0 }] }))
    s.applyUpload({ id: 'f1', state: 'uploading', sent: 4, total: 10 })
    expect(useChat.getState().rooms['default']!.files[0]).toMatchObject({ state: 'uploading', sent: 4 })
    s.applyUpload({ id: 'f1', state: 'error', sent: 4, total: 10, error: 'boom' })
    expect(useChat.getState().rooms['default']!.files[0]).toMatchObject({ state: 'error', error: 'boom' })
    const before = useChat.getState().rooms
    s.applyUpload({ id: 'nope', state: 'done', sent: 1, total: 1 })
    expect(useChat.getState().rooms).toBe(before)
  })

  it('patches a room and resets everything', () => {
    const s = useChat.getState()
    s.patch('default', (r) => ({ draft: r.draft + 'hello' }))
    s.patch('default', (r) => ({ draft: r.draft + ' world' }))
    expect(useChat.getState().rooms['default']!.draft).toBe('hello world')
    s.setCurrent('default')
    s.reset()
    expect(useChat.getState()).toMatchObject({ rooms: {}, current: null })
  })
})
