import { describe, expect, it } from 'vitest'
import type { BrainNote } from '@shared/events'
import { buildHeatmap, cellForWeeks, dayKey, dayLabel, levelOf, noteDay, weeksThatFit } from '../../src/renderer/lib/brain/heatmap'

const ts = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime() / 1000

function note(id: string, extra: Partial<BrainNote> = {}): BrainNote {
  return { id, title: id.replace(/\.md$/, ''), mtime: ts(2026, 10, 13), size: 1, tags: [], aliases: [], links: [], ghosts: [], attachments: [], ...extra }
}

describe('noteDay', () => {
  it('prefers the date the note gives, then the creation time, then the last change', () => {
    expect(noteDay(note('a.md', { dated: '2026-01-02', datedFrom: 'frontmatter', born: ts(2026, 5, 5) }))).toEqual({ day: '2026-01-02', from: 'frontmatter' })
    expect(noteDay(note('2026-03-04.md', { dated: '2026-03-04', datedFrom: 'name' }))).toEqual({ day: '2026-03-04', from: 'name' })
    expect(noteDay(note('b.md', { born: ts(2026, 5, 5, 23) }))).toEqual({ day: '2026-05-05', from: 'created' })
    expect(noteDay(note('c.md', { born: null }))).toEqual({ day: '2026-10-13', from: 'modified' })
  })
})

describe('buildHeatmap', () => {
  const today = new Date(2026, 9, 13) // a Tuesday
  const notes = [
    note('a.md', { born: ts(2026, 10, 13) }),
    note('b.md', { born: ts(2026, 10, 13) }),
    note('c.md', { dated: '2026-10-12', datedFrom: 'name' }),
    note('d.md', { dated: '2026-10-01', datedFrom: 'frontmatter' }),
    note('old.md', { dated: '2020-01-01', datedFrom: 'frontmatter' })
  ]
  const map = buildHeatmap(notes, today, 4)

  it('has full weeks, Sunday first, ending with the week of today', () => {
    expect(map.weeks).toHaveLength(4)
    expect(map.weeks.every((w) => w.length === 7)).toBe(true)
    expect(map.weeks[0]![0]!.day).toBe('2026-09-20')
    expect(map.weeks[3]![0]!.day).toBe('2026-10-11')
    expect(map.weeks[3]!.map((c) => c.future)).toEqual([false, false, false, true, true, true, true])
  })

  it('counts notes per day inside the range and keeps every day for the list', () => {
    const cell = (day: string) => map.weeks.flat().find((c) => c.day === day)!
    expect(cell('2026-10-13')).toMatchObject({ count: 2, level: 4 })
    expect(cell('2026-10-12')).toMatchObject({ count: 1, level: 2 })
    expect(cell('2026-10-01')).toMatchObject({ count: 1 })
    expect(map.total).toBe(4)
    expect(map.max).toBe(2)
    expect(map.activeDays).toBe(3)
    expect(map.byDay.get('2020-01-01')?.map((n) => n.id)).toEqual(['old.md'])
    expect(map.sources).toEqual({ frontmatter: 2, name: 1, created: 2, modified: 0 })
  })

  it('labels the week where a month starts, not a first column whose month is nearly over', () => {
    expect(map.months).toEqual([null, null, 'Oct', null]) // September has under 3 weeks left in the first column
  })
})

describe('helpers', () => {
  it('levels follow quarters of the busiest day', () => {
    expect([0, 1, 2, 3, 4, 8].map((n) => levelOf(n, 8))).toEqual([0, 1, 1, 2, 2, 4])
    expect(levelOf(3, 0)).toBe(0)
  })
  it('fits weeks to a width and formats days', () => {
    expect(weeksThatFit(220)).toBe(15)
    expect(weeksThatFit(50)).toBe(8)
    expect(weeksThatFit(5000)).toBe(156)
    expect(weeksThatFit(700, 152)).toBe(33) // 17 px cells: (700 - 25) / 20
    expect(weeksThatFit(700, 96)).toBe(56) // 9 px cells
    expect(cellForWeeks(740, 53)).toBe(10)
    expect(cellForWeeks(2000, 53)).toBe(20)
    expect(dayLabel('2026-10-03')).toBe('3 Oct 2026')
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
