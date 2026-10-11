import { describe, expect, it } from 'vitest'
import { nextOccurrences } from '../../src/renderer/lib/cronExpr'
import { sampleJob } from '../helpers/samples'

// 2026-10-11 is a Sunday. T0 = 10:00 at UTC+7 = 03:00Z.
const T0 = Date.UTC(2026, 9, 11, 3, 0, 0) / 1000
const DAY = 86400

const cron = (expr: string, over = {}) =>
  sampleJob({ schedule: { kind: 'cron', expr, display: expr }, nextRunTs: null, tzOffsetMin: 420, ...over })

/** The wall-clock fields of an epoch time in a zone, so assertions do not depend on the machine's zone. */
const wall = (t: number, offsetMin: number) => {
  const d = new Date((t + offsetMin * 60) * 1000)
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), dom: d.getUTCDate(), dow: d.getUTCDay(), month: d.getUTCMonth() + 1 }
}

describe('cron expressions', () => {
  it('finds a daily job once in 24 hours', () => {
    const t = nextOccurrences(cron('0 23 * * *'), T0, T0 + DAY)
    expect(t).toEqual([Date.UTC(2026, 9, 11, 16, 0, 0) / 1000])
  })

  it('handles steps: every 30 minutes gives 48 points', () => {
    expect(nextOccurrences(cron('*/30 * * * *'), T0, T0 + DAY)).toHaveLength(48)
  })

  it('handles an hour step: every 6 hours gives 4 points', () => {
    const t = nextOccurrences(cron('0 */6 * * *'), T0, T0 + DAY)
    expect(t.map((x) => wall(x, 420).h)).toEqual([12, 18, 0, 6])
  })

  it('handles ranges with steps and lists on weekdays', () => {
    const t = nextOccurrences(cron('0 9-17/4 * * 1,3,5'), T0, T0 + 7 * DAY)
    expect(t).toHaveLength(9)
    for (const x of t) {
      const w = wall(x, 420)
      expect([1, 3, 5]).toContain(w.dow)
      expect([9, 13, 17]).toContain(w.h)
    }
  })

  it('understands day names', () => {
    const t = nextOccurrences(cron('0 9 * * MON'), T0, T0 + 7 * DAY)
    expect(t).toHaveLength(1)
    expect(wall(t[0]!, 420)).toMatchObject({ dow: 1, h: 9 })
  })

  it('treats day-of-week 7 as Sunday', () => {
    const t = nextOccurrences(cron('0 9 * * 7'), T0 + DAY, T0 + 8 * DAY)
    expect(t).toHaveLength(1)
    expect(wall(t[0]!, 420).dow).toBe(0)
  })

  it('uses OR when both day-of-month and day-of-week are restricted', () => {
    const t = nextOccurrences(cron('0 0 13 * 5'), T0, T0 + 40 * DAY)
    const ws = t.map((x) => wall(x, 420))
    expect(ws.every((w) => w.dom === 13 || w.dow === 5)).toBe(true)
    expect(ws.some((w) => w.dom === 13 && w.dow !== 5)).toBe(true)
    expect(ws.some((w) => w.dow === 5 && w.dom !== 13)).toBe(true)
  })

  it('understands month names', () => {
    const from = Date.UTC(2026, 11, 20, 0, 0, 0) / 1000
    const t = nextOccurrences(cron('0 0 1 JAN *'), from, from + 40 * DAY)
    expect(t).toHaveLength(1)
    expect(wall(t[0]!, 420)).toMatchObject({ month: 1, dom: 1, h: 0 })
  })

  it('evaluates in the job time zone', () => {
    const t = nextOccurrences(cron('0 9 * * *', { tzOffsetMin: -300 }), T0, T0 + DAY)
    expect(t).toEqual([Date.UTC(2026, 9, 11, 14, 0, 0) / 1000])
  })

  it('always includes next_run_at and does not duplicate it', () => {
    const next = Date.UTC(2026, 9, 11, 16, 0, 0) / 1000
    const t = nextOccurrences(cron('0 23 * * *', { nextRunTs: next }), T0, T0 + DAY)
    expect(t).toEqual([next])
  })

  it('keeps next_run_at even when it is a second off the minute grid', () => {
    const next = Date.UTC(2026, 9, 11, 16, 0, 20) / 1000
    expect(nextOccurrences(cron('0 23 * * *', { nextRunTs: next }), T0, T0 + DAY)).toEqual([next])
  })

  it('honours the limit', () => {
    expect(nextOccurrences(cron('* * * * *'), T0, T0 + DAY, 10)).toHaveLength(10)
  })

  it('treats the window as half-open', () => {
    expect(nextOccurrences(cron('0 10 * * *', { tzOffsetMin: 420 }), T0, T0 + DAY).map((x) => wall(x, 420).h)).toEqual([10])
    expect(nextOccurrences(cron('0 10 * * *', { tzOffsetMin: 420 }), T0 + 1, T0 + DAY).map((x) => wall(x, 420).h)).toEqual([])
  })

  it('still draws paused jobs (the UI shows them as outlines)', () => {
    expect(nextOccurrences(cron('0 23 * * *', { state: 'paused' }), T0, T0 + DAY)).toHaveLength(1)
  })
})

describe('intervals', () => {
  const every = (text: string, next: number | null) =>
    sampleJob({ schedule: { kind: 'interval', expr: text, display: text }, nextRunTs: next, tzOffsetMin: 420 })

  it('counts runs of every 30m from next_run_at', () => {
    const t = nextOccurrences(every('every 30m', T0 + 600), T0, T0 + 7200)
    expect(t).toEqual([T0 + 600, T0 + 2400, T0 + 4200, T0 + 6000])
  })

  it('understands hours and days and bare forms', () => {
    expect(nextOccurrences(every('2h', T0 + 60), T0, T0 + DAY)).toHaveLength(12)
    expect(nextOccurrences(every('1d', T0 + 3600), T0, T0 + 3 * DAY)).toHaveLength(3)
  })

  it('anchors at the window start when next_run_at is unknown', () => {
    expect(nextOccurrences(every('every 6h', null), T0, T0 + DAY)).toHaveLength(4)
  })

  it('can read the interval from display when expr is empty', () => {
    const job = sampleJob({ schedule: { kind: 'interval', expr: null, display: 'every 12h' }, nextRunTs: T0 + 60 })
    expect(nextOccurrences(job, T0, T0 + DAY)).toHaveLength(2)
  })
})

describe('what it cannot read', () => {
  it.each(['@daily', '0 0 L * *', '0 0 * * 1#2', '61 * * * *', '* * * *', '*/0 * * * *', '5-1 * * * *', 'a b c d e', ''])(
    '%j only yields next_run_at',
    (expr) => {
      const next = T0 + 3600
      const job = sampleJob({ schedule: { kind: 'cron', expr: expr || null, display: expr }, nextRunTs: next })
      expect(nextOccurrences(job, T0, T0 + DAY)).toEqual([next])
    }
  )

  it('returns nothing when there is no usable schedule and no next_run_at', () => {
    const job = sampleJob({ schedule: { kind: 'weird', expr: null, display: 'whenever' }, nextRunTs: null })
    expect(nextOccurrences(job, T0, T0 + DAY)).toEqual([])
  })

  it('does not scan more than the maximum window', () => {
    const t = nextOccurrences(cron('0 0 1 1 *'), T0, T0 + 3650 * DAY)
    expect(t).toEqual([])
  })
})
