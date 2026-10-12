import { describe, expect, it } from 'vitest'
import { diffStats, foldDiff, hasConflictMarkers, isUnchanged, lineDiff, merge3 } from '@shared/textDiff'

describe('lineDiff', () => {
  it('marks added and removed lines', () => {
    const ops = lineDiff('a\nb\nc', 'a\nx\nc\nd')
    expect(ops).toEqual([
      { t: 'same', text: 'a' },
      { t: 'del', text: 'b' },
      { t: 'add', text: 'x' },
      { t: 'same', text: 'c' },
      { t: 'add', text: 'd' }
    ])
    expect(diffStats(ops)).toEqual({ added: 2, removed: 1 })
  })

  it('handles empty sides', () => {
    expect(lineDiff('', 'a\nb').map((o) => o.t)).toEqual(['add', 'add'])
    expect(lineDiff('a', '').map((o) => o.t)).toEqual(['del'])
    expect(isUnchanged(lineDiff('same', 'same'))).toBe(true)
    expect(isUnchanged(lineDiff('', ''))).toBe(true)
  })

  it('folds unchanged runs', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const b = a.replace('l10', 'changed')
    const rows = foldDiff(lineDiff(a, b), 2)
    expect(rows[0]).toEqual({ t: 'skip', n: 8 })
    expect(rows.at(-1)).toEqual({ t: 'skip', n: 7 })
    expect(rows.filter((r) => r.t === 'del' || r.t === 'add')).toHaveLength(2)
  })
})

describe('merge3', () => {
  const base = 'one\ntwo\nthree\nfour\nfive'

  it('keeps edits in different places from both sides', () => {
    const r = merge3(base, 'ONE\ntwo\nthree\nfour\nfive', 'one\ntwo\nthree\nfour\nFIVE')
    expect(r).toEqual({ text: 'ONE\ntwo\nthree\nfour\nFIVE', conflicts: 0 })
  })

  it('takes the one side that changed', () => {
    expect(merge3(base, base, 'x').text).toBe('x')
    expect(merge3(base, 'y', base).text).toBe('y')
  })

  it('accepts the same edit on both sides', () => {
    const e = 'one\ntwo\nTHREE\nfour\nfive'
    expect(merge3(base, e, e)).toEqual({ text: e, conflicts: 0 })
  })

  it('marks a conflict when both change the same line differently', () => {
    const r = merge3(base, 'one\ntwo\nmine\nfour\nfive', 'one\ntwo\ntheirs\nfour\nfive')
    expect(r.conflicts).toBe(1)
    expect(r.text).toBe('one\ntwo\n<<<<<<< mine\nmine\n=======\ntheirs\n>>>>>>> theirs\nfour\nfive')
    expect(hasConflictMarkers(r.text)).toBe(true)
  })

  it('merges an insertion on one side with an edit on the other', () => {
    const r = merge3(base, 'one\ntwo\nthree\nfour\nfive\nsix', 'ONE\ntwo\nthree\nfour\nfive')
    expect(r).toEqual({ text: 'ONE\ntwo\nthree\nfour\nfive\nsix', conflicts: 0 })
  })

  it('treats two different insertions at the same place as a conflict', () => {
    const r = merge3('a\nb', 'a\nmine\nb', 'a\ntheirs\nb')
    expect(r.conflicts).toBe(1)
  })

  it('merges a deletion with a change elsewhere', () => {
    const r = merge3(base, 'one\nthree\nfour\nfive', 'one\ntwo\nthree\nfour\nFIVE')
    expect(r).toEqual({ text: 'one\nthree\nfour\nFIVE', conflicts: 0 })
  })
})
