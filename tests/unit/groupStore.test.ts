import { describe, expect, it } from 'vitest'
import { ENTRIES_PER_GROUP } from '@shared/groups'
import { SettingsStore } from '../../src/main/store/settingsStore'

function connected(): SettingsStore {
  const store = new SettingsStore(':memory:')
  store.upsertConnection({ name: 'vps', host: '10.0.0.1', port: 22, username: 'hermes', remember: true })
  return store
}

describe('GroupStore', () => {
  it('needs a connection', () => {
    const store = new SettingsStore(':memory:')
    expect(store.groups.list()).toEqual([])
    expect(() => store.groups.create('mc-aaaaaaaaaa', 'Ops', ['ada', 'bo'])).toThrow()
  })

  it('creates rooms and lists them by their latest activity', () => {
    const g = connected().groups
    g.create('mc-aaaaaaaaaa', 'Ops', ['ada', 'bo'], 1000)
    g.create('mc-bbbbbbbbbb', 'Research', ['bo', 'cy'], 2000)
    expect(g.list().map((r) => r.id)).toEqual(['mc-bbbbbbbbbb', 'mc-aaaaaaaaaa'])
    g.addEntry('mc-aaaaaaaaaa', 'user', 'hello', 'ok', 3000)
    const [first] = g.list()
    expect(first).toMatchObject({ id: 'mc-aaaaaaaaaa', name: 'Ops', members: ['ada', 'bo'], needsYou: false, last: { ts: 3000, author: 'user', text: 'hello' } })
    expect(g.get('mc-bbbbbbbbbb')?.last).toBeNull()
    expect(g.get('mc-cccccccccc')).toBeNull()
  })

  it('keeps member sessions and what they saw when the members change', () => {
    const g = connected().groups
    g.create('mc-aaaaaaaaaa', 'Ops', ['ada', 'bo'])
    g.setSession('mc-aaaaaaaaaa', 'ada', 's-1')
    g.setSeen('mc-aaaaaaaaaa', 'ada', 4)
    g.setSession('mc-aaaaaaaaaa', 'bo', 's-2')
    const r = g.update('mc-aaaaaaaaaa', { name: 'Ops 2', members: ['cy', 'ada'] })
    expect(r).toMatchObject({ name: 'Ops 2', members: ['cy', 'ada'] })
    expect(g.members('mc-aaaaaaaaaa')).toEqual([
      { profile: 'cy', sessionId: null, seenSeq: 0 },
      { profile: 'ada', sessionId: 's-1', seenSeq: 4 }
    ])
    expect(g.update('mc-zzzzzzzzzz', { name: 'x' })).toBeNull()
  })

  it('numbers entries, pages them and keeps the newest ones', () => {
    const g = connected().groups
    g.create('mc-aaaaaaaaaa', 'Ops', ['ada', 'bo'])
    const a = g.addEntry('mc-aaaaaaaaaa', 'user', 'one', 'ok')
    const b = g.addEntry('mc-aaaaaaaaaa', 'ada', '(pass)', 'pass')
    expect([a.seq, b.seq]).toEqual([1, 2])
    expect(g.lastSeq('mc-aaaaaaaaaa')).toBe(2)
    expect(g.entries('mc-aaaaaaaaaa').map((e) => e.text)).toEqual(['one', '(pass)'])
    expect(g.entries('mc-aaaaaaaaaa', { before: 2 }).map((e) => e.seq)).toEqual([1])
    for (let i = 0; i < ENTRIES_PER_GROUP + 5; i++) g.addEntry('mc-aaaaaaaaaa', 'user', `m${i}`, 'ok')
    const all = g.entries('mc-aaaaaaaaaa', { limit: 5000 })
    expect(all).toHaveLength(ENTRIES_PER_GROUP)
    expect(all.at(-1)!.text).toBe(`m${ENTRIES_PER_GROUP + 4}`)
    expect(g.entries('mc-aaaaaaaaaa', { limit: 3 }).map((e) => e.text)).toEqual([`m${ENTRIES_PER_GROUP + 2}`, `m${ENTRIES_PER_GROUP + 3}`, `m${ENTRIES_PER_GROUP + 4}`])
  })

  it('marks a room that needs the user, clears history and removes rooms', () => {
    const g = connected().groups
    g.create('mc-aaaaaaaaaa', 'Ops', ['ada', 'bo'])
    g.setNeedsYou('mc-aaaaaaaaaa', true)
    expect(g.get('mc-aaaaaaaaaa')?.needsYou).toBe(true)
    g.addEntry('mc-aaaaaaaaaa', 'user', 'one', 'ok')
    g.setSeen('mc-aaaaaaaaaa', 'ada', 1)
    g.setSession('mc-aaaaaaaaaa', 'ada', 's-1')
    g.clearEntries()
    expect(g.entries('mc-aaaaaaaaaa')).toEqual([])
    expect(g.members('mc-aaaaaaaaaa')[0]).toEqual({ profile: 'ada', sessionId: 's-1', seenSeq: 0 })
    expect(g.get('mc-aaaaaaaaaa')?.needsYou).toBe(false)
    g.remove('mc-aaaaaaaaaa')
    expect(g.list()).toEqual([])
    expect(g.members('mc-aaaaaaaaaa')).toEqual([])
  })

  it('is dropped with the connection', () => {
    const store = connected()
    store.groups.create('mc-aaaaaaaaaa', 'Ops', ['ada', 'bo'])
    store.groups.addEntry('mc-aaaaaaaaaa', 'user', 'one', 'ok')
    store.forgetConnection()
    store.upsertConnection({ name: 'vps', host: '10.0.0.1', port: 22, username: 'hermes', remember: true })
    expect(store.groups.list()).toEqual([])
  })
})
