import { describe, expect, it } from 'vitest'
import type { AgentFile } from '@shared/agentCfg'
import {
  anyDirty,
  draftKey,
  emptyDraft,
  isDirty,
  keepMine,
  mergeTheirs,
  saveBlock,
  takeTheirs,
  withConflict,
  withEdit,
  withFile,
  withRevert,
  withSaved,
  withServerChange
} from '../../src/renderer/lib/agentCfg'

const file = (text: string, hash: string | null = text ? `h:${text}` : null): AgentFile => ({ exists: hash !== null, text, hash, mtime: 1 })
const loaded = (text: string, kind: 'soul' | 'memory' | 'user' = 'soul') => withFile(emptyDraft('default', kind), file(text))

describe('draft lifecycle', () => {
  it('is clean after a load and dirty after an edit', () => {
    const d = loaded('a')
    expect(isDirty(d)).toBe(false)
    expect(isDirty(withEdit(d, 'b'))).toBe(true)
    expect(isDirty(withEdit(d, 'a'))).toBe(false)
    expect(isDirty(emptyDraft('default', 'soul'))).toBe(false)
  })

  it('keys by profile and kind', () => {
    expect(draftKey('atlas', 'memory')).toBe('atlas:memory')
    expect(anyDirty({ a: loaded('x'), b: withEdit(loaded('x'), 'y') })).toBe(true)
    expect(anyDirty({ a: loaded('x') })).toBe(false)
  })

  it('a save makes the new text the base and remembers the old one for Revert', () => {
    const d = withSaved(withEdit(loaded('one'), 'two'), file('two'), 'one')
    expect(d).toMatchObject({ baseText: 'two', baseHash: 'h:two', text: 'two', undo: ['one'] })
    expect(isDirty(d)).toBe(false)
    const r = withRevert(d)
    expect(r.text).toBe('one')
    expect(r.undo).toEqual([])
    expect(isDirty(r)).toBe(true)
    expect(withRevert(r)).toBe(r)
  })

  it('keeps ten undo steps at most', () => {
    let d = loaded('0')
    for (let i = 1; i <= 12; i++) d = withSaved(d, file(String(i)), String(i - 1))
    expect(d.undo).toHaveLength(10)
    expect(d.undo[0]).toBe('2')
  })
})

describe('server changes', () => {
  it('a clean draft follows the server', () => {
    const d = withServerChange(loaded('a'), file('b'))
    expect(d).toMatchObject({ text: 'b', baseHash: 'h:b', notice: 'Updated from the server.' })
  })

  it('a dirty draft is never replaced; it gets a notice', () => {
    const d = withServerChange(withEdit(loaded('a'), 'mine'), file('b'))
    expect(d.text).toBe('mine')
    expect(d.serverChanged?.text).toBe('b')
    expect(d.baseText).toBe('a')
  })
})

describe('conflict choices', () => {
  const conflicted = () => withConflict(withEdit(loaded('l1\nl2\nl3'), 'MINE\nl2\nl3'), file('l1\nl2\nTHEIRS'))

  it('take theirs drops my edits', () => {
    const d = takeTheirs(conflicted())
    expect(d).toMatchObject({ text: 'l1\nl2\nTHEIRS', baseText: 'l1\nl2\nTHEIRS', conflict: null })
    expect(isDirty(d)).toBe(false)
  })

  it('keep mine rebases onto the server file so the next save overwrites it', () => {
    const d = keepMine(conflicted())
    expect(d).toMatchObject({ text: 'MINE\nl2\nl3', baseText: 'l1\nl2\nTHEIRS', baseHash: 'h:l1\nl2\nTHEIRS', conflict: null })
    expect(isDirty(d)).toBe(true)
  })

  it('merge combines edits in different places', () => {
    const d = mergeTheirs(conflicted())
    expect(d.text).toBe('MINE\nl2\nTHEIRS')
    expect(d.baseText).toBe('l1\nl2\nTHEIRS')
    expect(saveBlock(d, true)).toBeNull()
  })

  it('merge marks overlapping edits and blocks Save until they are fixed', () => {
    const c = withConflict(withEdit(loaded('x'), 'mine'), file('theirs'))
    const d = mergeTheirs(c)
    expect(d.text).toContain('<<<<<<< mine')
    expect(d.notice).toMatch(/could not be merged/)
    expect(saveBlock(d, true)).toBe('markers')
    expect(saveBlock(withEdit(d, 'resolved'), true)).toBeNull()
  })
})

describe('saveBlock', () => {
  it('explains why Save is off', () => {
    expect(saveBlock(loaded('a'), true)).toBe('clean')
    expect(saveBlock(withEdit(loaded('a'), 'b'), false)).toBe('offline')
    expect(saveBlock({ ...withEdit(loaded('a'), 'b'), saving: true }, true)).toBe('saving')
    expect(saveBlock(withEdit(loaded('m', 'memory'), 'x'.repeat(2201)), true)).toBe('too-long')
    expect(saveBlock(withEdit(loaded('m', 'memory'), 'x'.repeat(2200)), true)).toBeNull()
    expect(saveBlock(withEdit(loaded('a'), 'x'.repeat(5000)), true)).toBeNull()
  })
})
