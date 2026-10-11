import type { CronJob } from '@shared/events'

interface Parsed {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domStar: boolean
  dowStar: boolean
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MAX_WINDOW_S = 40 * 86400

function parseField(src: string, min: number, max: number, names: string[] | null, nameBase: number): Set<number> | null {
  const out = new Set<number>()
  const value = (tok: string): number | null => {
    if (/^\d+$/.test(tok)) return Number(tok)
    const i = names ? names.indexOf(tok.toUpperCase()) : -1
    return i >= 0 ? i + nameBase : null
  }
  for (const part of src.split(',')) {
    if (part === '') return null
    const pieces = part.split('/')
    if (pieces.length > 2) return null
    const range = pieces[0]!
    let step = 1
    if (pieces[1] !== undefined) {
      if (!/^\d+$/.test(pieces[1])) return null
      step = Number(pieces[1])
      if (step < 1) return null
    }
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = max
    } else if (range.includes('-')) {
      const [a, b, ...extra] = range.split('-')
      if (extra.length > 0) return null
      const x = value(a ?? '')
      const y = value(b ?? '')
      if (x === null || y === null) return null
      lo = x
      hi = y
    } else {
      const x = value(range)
      if (x === null) return null
      lo = x
      hi = pieces[1] !== undefined ? max : x
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

function parseCron(expr: string): Parsed | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return null
  const minute = parseField(f[0]!, 0, 59, null, 0)
  const hour = parseField(f[1]!, 0, 23, null, 0)
  const dom = parseField(f[2]!, 1, 31, null, 0)
  const month = parseField(f[3]!, 1, 12, MONTHS, 1)
  const dowRaw = parseField(f[4]!, 0, 7, DAYS, 0)
  if (!minute || !hour || !dom || !month || !dowRaw) return null
  const dow = new Set([...dowRaw].map((d) => d % 7))
  return { minute, hour, dom, month, dow, domStar: f[2]!.startsWith('*'), dowStar: f[4]!.startsWith('*') }
}

function matches(p: Parsed, local: Date): boolean {
  if (!p.minute.has(local.getUTCMinutes()) || !p.hour.has(local.getUTCHours()) || !p.month.has(local.getUTCMonth() + 1)) return false
  const domOk = p.dom.has(local.getUTCDate())
  const dowOk = p.dow.has(local.getUTCDay())
  return p.domStar || p.dowStar ? domOk && dowOk : domOk || dowOk
}

const INTERVAL = /^(?:every\s+)?(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/

function intervalSeconds(text: string | null): number | null {
  if (!text) return null
  const m = INTERVAL.exec(text.trim().toLowerCase())
  if (!m) return null
  const n = Number(m[1])
  if (n < 1) return null
  const unit = m[2]![0]!
  return n * (unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400)
}

/**
 * Scheduled run times in [fromTs, toTs), in epoch seconds. The job's own next_run_at is always trusted;
 * the rest is derived from a standard 5-field cron expression or a simple interval. Anything else yields just
 * next_run_at.
 */
export function nextOccurrences(job: CronJob, fromTs: number, toTs: number, limit = 200): number[] {
  const to = Math.min(toTs, fromTs + MAX_WINDOW_S)
  const next = job.nextRunTs
  const derived: number[] = []

  const interval = intervalSeconds(job.schedule.expr) ?? intervalSeconds(job.schedule.display)
  const parsed = job.schedule.expr ? parseCron(job.schedule.expr) : null

  if (parsed) {
    const offsetMin = job.tzOffsetMin ?? -new Date().getTimezoneOffset()
    for (let t = Math.ceil(fromTs / 60) * 60; t < to && derived.length < limit * 4; t += 60) {
      if (matches(parsed, new Date((t + offsetMin * 60) * 1000))) derived.push(t)
    }
  } else if (interval !== null) {
    let t = next ?? fromTs
    if (t < fromTs) t += Math.ceil((fromTs - t) / interval) * interval
    for (; t < to && derived.length < limit * 4; t += interval) derived.push(t)
  }

  const out = derived.filter((t) => next === null || Math.abs(t - next) >= 60)
  if (next !== null && next >= fromTs && next < to) out.push(next)
  return out.sort((a, b) => a - b).slice(0, limit)
}
