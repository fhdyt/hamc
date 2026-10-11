import { beforeEach, describe, expect, it } from 'vitest'
import { useBrain } from '../../src/renderer/stores/brain'
import { sampleBrain, sampleNote } from '../helpers/samples'

beforeEach(() => useBrain.getState().reset())

describe('useBrain', () => {
  it('starts unset and not loaded', () => {
    const s = useBrain.getState()
    expect([s.loaded, s.vault, s.phase, s.notes.size]).toEqual([false, null, 'unset', 0])
  })

  it('goes loading then live over the chunks of a snapshot', () => {
    const s = useBrain.getState()
    s.setVault('/v')
    expect(useBrain.getState().phase).toBe('loading')
    const [a, b, c] = sampleBrain().notes
    s.applyBrain(sampleBrain({ done: false, notes: [a!, b!] }))
    expect(useBrain.getState().phase).toBe('loading')
    expect(useBrain.getState().notes.size).toBe(2)
    s.applyBrain(sampleBrain({ first: false, done: true, notes: [c!] }))
    expect(useBrain.getState()).toMatchObject({ phase: 'live', total: 3 })
    expect(useBrain.getState().notes.size).toBe(3)
    expect(useBrain.getState().pulse.ids).toEqual([])
  })

  it('a new first snapshot replaces the old notes', () => {
    const s = useBrain.getState()
    s.applyBrain(sampleBrain())
    s.applyBrain(sampleBrain({ notes: [sampleNote({ id: 'Only.md' })], total: 1 }))
    expect([...useBrain.getState().notes.keys()]).toEqual(['Only.md'])
  })

  it('a delta upserts, removes and pulses the changed notes', () => {
    const s = useBrain.getState()
    s.applyBrain(sampleBrain())
    const before = useBrain.getState().version
    s.applyBrain(sampleBrain({ mode: 'delta', first: false, notes: [sampleNote({ id: 'New.md', title: 'New' }), sampleNote({ id: 'Alpha.md', title: 'Alpha', links: [] })], removed: ['folder/Gamma.md'], total: 3 }))
    const now = useBrain.getState()
    expect([...now.notes.keys()].sort()).toEqual(['Alpha.md', 'Index.md', 'New.md'])
    expect(now.notes.get('Alpha.md')!.links).toEqual([])
    expect(now.pulse).toEqual({ ids: ['New.md', 'Alpha.md'], seq: 1 })
    expect(now.version).toBeGreaterThan(before)
    expect(now.phase).toBe('live')
    s.applyBrain(sampleBrain({ mode: 'delta', first: false, notes: [sampleNote({ id: 'New.md', title: 'New' })], removed: [], total: 3 }))
    expect(useBrain.getState().pulse.seq).toBe(2)
  })

  it('forgets a selection, local graph and open note that disappear', () => {
    const s = useBrain.getState()
    s.applyBrain(sampleBrain())
    s.select('Alpha.md')
    s.setLocal({ id: 'Alpha.md', depth: 2 })
    s.openNote('Alpha.md')
    s.applyBrain(sampleBrain({ mode: 'delta', first: false, notes: [], removed: ['Alpha.md'] }))
    const now = useBrain.getState()
    expect([now.selected, now.local, now.noteModal]).toEqual([null, null, null])
  })

  it('does not wipe a snapshot that arrived before the vault path was read', () => {
    const s = useBrain.getState()
    s.applyBrain(sampleBrain())
    s.setVault('/v')
    expect(useBrain.getState().notes.size).toBe(3)
    expect(useBrain.getState().phase).toBe('live')
  })

  it('switching or clearing the vault clears everything', () => {
    const s = useBrain.getState()
    s.setVault('/a')
    s.applyBrain(sampleBrain())
    s.select('Alpha.md')
    s.setVault('/b')
    expect(useBrain.getState()).toMatchObject({ vault: '/b', phase: 'loading', selected: null })
    expect(useBrain.getState().notes.size).toBe(0)
    s.setVault(null)
    expect(useBrain.getState()).toMatchObject({ vault: null, phase: 'unset' })
  })

  it('shows an error only when a vault is set, and the next event clears it', () => {
    const s = useBrain.getState()
    s.setError('x')
    expect(useBrain.getState().phase).toBe('unset')
    s.setVault('/v')
    s.setError('vault folder not found')
    expect(useBrain.getState()).toMatchObject({ phase: 'error', error: 'vault folder not found' })
    s.applyBrain(sampleBrain())
    expect(useBrain.getState()).toMatchObject({ phase: 'live', error: null })
  })

  it('keeps hover, search and truncation flags', () => {
    const s = useBrain.getState()
    s.setHover('a')
    s.setSearch('tag:x')
    s.applyBrain(sampleBrain({ truncated: true }))
    expect(useBrain.getState()).toMatchObject({ hovered: 'a', search: 'tag:x', truncated: true })
    s.reset()
    expect(useBrain.getState()).toMatchObject({ hovered: null, search: '', truncated: false })
  })
})
