import type { BrainNote } from '@shared/events'

/* The Dashboard "notes" panel: a GitHub-style contribution calendar of the days the vault notes were written. Pure. */

/** Where a note's day came from, best first. */
export type DaySource = 'frontmatter' | 'name' | 'created' | 'modified'

export interface NoteDay {
  day: string
  from: DaySource
}

export interface HeatCell {
  day: string
  count: number
  /** 0 (none) to 4 (busiest), like GitHub. */
  level: number
  /** After today: drawn empty and not focusable. */
  future: boolean
}

export interface Heatmap {
  /** One column per week, Sunday first; every column has 7 cells. */
  weeks: HeatCell[][]
  /** Month names above the week where the month starts (null elsewhere). */
  months: (string | null)[]
  total: number
  /** Busiest day in the range. */
  max: number
  activeDays: number
  /** Notes per day for the whole vault, so a click can list them. */
  byDay: Map<string, BrainNote[]>
  sources: Record<DaySource, number>
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD` of a local date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The local calendar day of an epoch-seconds time. */
export const dayOfTs = (ts: number): string => dayKey(new Date(ts * 1000))

/** The day a note was written: its own date (frontmatter, file name), else when the file was created, else modified. */
export function noteDay(n: BrainNote): NoteDay {
  if (n.dated) return { day: n.dated, from: n.datedFrom === 'name' ? 'name' : 'frontmatter' }
  if (n.born) return { day: dayOfTs(n.born), from: 'created' }
  return { day: dayOfTs(n.mtime), from: 'modified' }
}

/** GitHub's buckets: a quarter of the busiest day each. */
export function levelOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The last `weeks` weeks up to the week of `today` (a local date). */
export function buildHeatmap(notes: Iterable<BrainNote>, today: Date, weeks: number): Heatmap {
  const byDay = new Map<string, BrainNote[]>()
  const sources: Record<DaySource, number> = { frontmatter: 0, name: 0, created: 0, modified: 0 }
  for (const n of notes) {
    const d = noteDay(n)
    sources[d.from]++
    const list = byDay.get(d.day)
    if (list) list.push(n)
    else byDay.set(d.day, [n])
  }
  for (const list of byDay.values()) list.sort((a, b) => a.title.localeCompare(b.title))

  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const todayKey = dayKey(end)
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - end.getDay() - (weeks - 1) * 7)
  const cols: { day: string; count: number; future: boolean }[][] = []
  const months: (string | null)[] = []
  let total = 0
  let max = 0
  let activeDays = 0
  let lastMonth = -1
  for (let w = 0; w < weeks; w++) {
    const col: { day: string; count: number; future: boolean }[] = []
    let label: string | null = null
    for (let i = 0; i < 7; i++) {
      // a new Date per day keeps DST changes out of the arithmetic
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i)
      const key = dayKey(d)
      const future = key > todayKey
      const count = future ? 0 : (byDay.get(key)?.length ?? 0)
      if (i === 0 && d.getMonth() !== lastMonth) {
        // skip a label on the first column when its month is almost over, so two labels do not collide
        if (w > 0 || d.getDate() <= 14) label = MONTHS[d.getMonth()]!
        lastMonth = d.getMonth()
      }
      total += count
      if (count > 0) activeDays++
      max = Math.max(max, count)
      col.push({ day: key, count, future })
    }
    cols.push(col)
    months.push(label)
  }
  return { weeks: cols.map((c) => c.map((x) => ({ ...x, level: levelOf(x.count, max) }))), months, total, max, activeDays, byDay, sources }
}

/** Day labels column (25 px) and the 3 px gap of the grid; the month row is 12 px. */
const LABEL_W = 25
const GAP = 3
const MONTH_H = 12

/**
 * Weeks for a grid that fills a box: the height sets the cell size (7 rows under the month row), and as many
 * roughly square weeks as fit the width are shown (8 to 156); the columns then stretch to the last pixel.
 */
export function weeksThatFit(width: number, height = MONTH_H + 7 * (10 + GAP)): number {
  const cell = Math.max(6, (height - MONTH_H - 7 * GAP) / 7)
  return Math.max(8, Math.min(156, Math.floor((width - LABEL_W) / (cell + GAP))))
}

/** Square cells for a fixed number of weeks across a width (the year view), 8 to 20 px. */
export function cellForWeeks(width: number, weeks: number): number {
  return Math.max(8, Math.min(20, Math.floor((width - LABEL_W) / weeks - GAP)))
}

/** "12 Oct 2026" for a `YYYY-MM-DD`. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

export const noteCount = (n: number): string => `${n} note${n === 1 ? '' : 's'}`
