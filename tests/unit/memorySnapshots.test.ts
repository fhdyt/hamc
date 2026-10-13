import { describe, expect, it } from 'vitest'
import { MemorySnapshots, sha256 } from '../../src/main/memory/snapshots'
import { SettingsStore, SNAPSHOTS_PER_FILE, SNAPSHOT_MAX_AGE_MS } from '../../src/main/store/settingsStore'
import type { MemoryFileEvent } from '@shared/events'

const ev = (text: string, over: Partial<MemoryFileEvent> = {}): MemoryFileEvent => ({
  profile: 'default', file: 'memory', hash: sha256(text), text, truncated: false, size: text.length, mtime: 1, agentTs: null, agentSession: null, ...over
})

function setup() {
  const store = new SettingsStore(':memory:')
  const id = store.upsertConnection({ name: 'x', host: 'h', port: 22, username: 'u', remember: false })
  let now = 1_000_000
  const changed: string[] = []
  const snaps = new MemorySnapshots({ store, connectionId: () => id, changed: (p, f) => changed.push(`${p}:${f}`), now: () => now })
  return { store, snaps, changed, id, tick: (ms: number) => (now += ms) }
}

describe('MemorySnapshots', () => {
  it('keeps one version per content and guesses the author', () => {
    const { snaps, changed, tick } = setup()
    snaps.ingest(ev('a'))
    snaps.ingest(ev('a'))
    tick(1000)
    snaps.ingest(ev('a\n§\nb', { agentTs: 5, agentSession: 's1' }))
    tick(1000)
    snaps.ingest(ev('a\n§\nb\n§\nc'))
    snaps.recordSave('default', 'memory', 'edited by you', 2)
    snaps.ingest(ev('edited by you'))
    const v = snaps.versions('default', 'memory')
    expect(v.map((x) => [x.author, x.chars, x.sessionId])).toEqual([
      ['you', 13, null],
      ['other', 9, null],
      ['agent', 5, 's1'],
      ['first', 1, null]
    ])
    expect(changed).toHaveLength(4)
    expect(snaps.version(v[3]!.id)).toEqual({ ok: true, id: v[3]!.id, text: 'a' })
    expect(snaps.version(99999)).toEqual({ ok: false, error: 'not-found' })
  })

  it('labels a difference found right after a new stream as while away', () => {
    const { snaps } = setup()
    snaps.ingest(ev('a'))
    snaps.reset()
    snaps.ingest(ev('changed while closed'))
    snaps.ingest(ev('then live'))
    expect(snaps.versions('default', 'memory').map((x) => x.author)).toEqual(['other', 'away', 'first'])
  })

  it('keeps files and profiles apart, and clears the connection', () => {
    const { snaps } = setup()
    snaps.ingest(ev('m'))
    snaps.ingest(ev('u', { file: 'user' }))
    snaps.ingest(ev('m', { profile: 'scout' }))
    expect(snaps.versions('default', 'user')).toHaveLength(1)
    expect(snaps.versions('scout', 'memory')).toHaveLength(1)
    expect(snaps.clear()).toBe(3)
    expect(snaps.versions('default', 'memory')).toEqual([])
  })
})

describe('memory_snapshots retention', () => {
  it('keeps 200 versions per file and drops those older than 180 days, but never the newest', () => {
    const { store, id } = setup()
    const add = (i: number, takenAt: number) => store.addSnapshot({ connectionId: id, profile: 'p', file: 'memory', takenAt, hash: `h${i}`, content: `c${i}`, author: 'other', sessionId: null, mtime: null })
    for (let i = 0; i < SNAPSHOTS_PER_FILE + 5; i++) add(i, 10_000_000_000 + i)
    expect(store.listSnapshots(id, 'p', 'memory')).toHaveLength(SNAPSHOTS_PER_FILE)
    expect(store.listSnapshots(id, 'p', 'memory').at(-1)!.hash).toBe('h5')
    add(999, 10_000_000_000 + SNAPSHOT_MAX_AGE_MS + 1000)
    expect(store.listSnapshots(id, 'p', 'memory').map((r) => r.hash)).toEqual(['h999'])
  })

  it('forgetting the connection drops its versions', () => {
    const { store, snaps, id } = setup()
    snaps.ingest(ev('x'))
    store.forgetConnection()
    expect(store.listSnapshots(id, 'default', 'memory')).toEqual([])
  })
})

describe('a save racing the collector', () => {
  it('counts the collector event as yours when it carries the text being saved', () => {
    const { snaps } = setup()
    snaps.ingest(ev('a'))
    snaps.expectSave('default', 'memory', 'saved text')
    snaps.ingest(ev('saved text'))
    snaps.recordSave('default', 'memory', 'saved text', 3)
    expect(snaps.versions('default', 'memory').map((x) => x.author)).toEqual(['you', 'first'])
  })
})
