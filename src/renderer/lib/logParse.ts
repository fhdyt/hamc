import type { LogLevel } from '@shared/logs'

export interface LogLine {
  /** Position among the parsed lines. */
  index: number
  /** The line as read, with any continuation lines joined by newlines. */
  raw: string
  /** The wall-clock time as if it were UTC, in seconds; null when the line has no readable timestamp. */
  naive: number | null
  /** The offset from UTC in seconds when the timestamp names one (Z or +07:00); null for a wall clock of the server. */
  tz: number | null
  level: LogLevel
  component: string | null
  message: string
}

const TIME = /^\[?(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:[.,](\d{1,6}))?(Z|[+-]\d\d:?\d\d)?\]?\s*/
const LEVEL = /^\[?(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\]?(?=[\s:\]|-]|$)[\s:\]|-]*/
const BRACKET_COMPONENT = /^\[([A-Za-z_][\w.-]{0,60})\]\s*[:|-]?\s*/
const PLAIN_COMPONENT = /^([A-Za-z_][\w.-]{0,60})\s*(?::\s+|\s-\s+|\|\s*)/

const LEVELS: Record<string, LogLevel> = { DEBUG: 'DEBUG', INFO: 'INFO', WARNING: 'WARNING', WARN: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL', FATAL: 'CRITICAL' }

function offsetSeconds(tz: string): number {
  if (tz === 'Z') return 0
  const sign = tz.startsWith('-') ? -1 : 1
  const digits = tz.slice(1).replace(':', '')
  return sign * (Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60)
}

/** One line of a Hermes log. The format is not documented, so every part is optional and nothing is ever dropped. */
export function parseLine(raw: string, index = 0): LogLine {
  let rest = raw
  let naive: number | null = null
  let tz: number | null = null
  const t = TIME.exec(rest)
  if (t) {
    naive = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]), Number(t[4]), Number(t[5]), Number(t[6])) / 1000 + (t[7] ? Number(`0.${t[7]}`) : 0)
    tz = t[8] ? offsetSeconds(t[8]) : null
    rest = rest.slice(t[0].length)
  }
  let level: LogLevel = 'UNKNOWN'
  const l = LEVEL.exec(rest)
  if (l) {
    level = LEVELS[l[1]!]!
    rest = rest.slice(l[0].length)
  }
  let component: string | null = null
  if (level !== 'UNKNOWN') {
    const c = BRACKET_COMPONENT.exec(rest) ?? PLAIN_COMPONENT.exec(rest)
    if (c) {
      component = c[1]!
      rest = rest.slice(c[0].length)
    }
  }
  return { index, raw, naive, tz, level, component, message: level === 'UNKNOWN' && naive === null ? raw : rest }
}

/**
 * Parses a list of lines. A line without a timestamp that follows a timestamped line (a traceback, a wrapped message)
 * belongs to it. In a log that has no timestamps at all, every line stays its own line.
 */
export function parseLines(raws: readonly string[]): LogLine[] {
  const out: LogLine[] = []
  for (const raw of raws) {
    const line = parseLine(raw, out.length)
    const prev = out[out.length - 1]
    if (prev && prev.naive !== null && line.naive === null) {
      prev.raw += `\n${raw}`
      prev.message += `\n${raw}`
      continue
    }
    out.push(line)
  }
  return out
}
