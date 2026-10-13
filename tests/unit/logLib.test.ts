import { describe, expect, it } from 'vitest'
import { componentsOf, filterLines, serverOffset, splitMatches, type LogFilter } from '../../src/renderer/lib/logFilter'
import { parseLine, parseLines } from '../../src/renderer/lib/logParse'

describe('parseLine', () => {
  it('reads a timestamp, a level and a component', () => {
    const l = parseLine('2026-10-13 15:12:00,123 INFO agent.run: session started s-1')
    expect(l.level).toBe('INFO')
    expect(l.component).toBe('agent.run')
    expect(l.message).toBe('session started s-1')
    expect(l.naive).toBe(Date.UTC(2026, 9, 13, 15, 12, 0) / 1000 + 0.123)
    expect(l.tz).toBeNull()
  })
  it('reads the other common shapes', () => {
    expect(parseLine('[2026-10-13T15:12:00Z] ERROR [gateway.run] polling failed')).toMatchObject({ level: 'ERROR', component: 'gateway.run', message: 'polling failed', tz: 0 })
    expect(parseLine('2026-10-13 15:12:00+07:00 WARN tools - slow tool')).toMatchObject({ level: 'WARNING', component: 'tools', message: 'slow tool', tz: 25200 })
    expect(parseLine('2026-10-13 15:12:00 CRITICAL boom')).toMatchObject({ level: 'CRITICAL', component: null, message: 'boom' })
    expect(parseLine('2026-10-13 15:12:00 FATAL x: y')).toMatchObject({ level: 'CRITICAL' })
  })
  it('keeps a message that merely has a word before a space as a message, not a component', () => {
    expect(parseLine('2026-10-13 15:12:00 INFO session started s-1')).toMatchObject({ component: null, message: 'session started s-1' })
  })
  it('takes a level without a timestamp and calls the rest unknown', () => {
    expect(parseLine('ERROR something broke')).toMatchObject({ level: 'ERROR', naive: null, message: 'something broke' })
    expect(parseLine('just some text')).toMatchObject({ level: 'UNKNOWN', naive: null, component: null, message: 'just some text' })
  })
})

describe('parseLines', () => {
  it('keeps indented or plain lines with the timestamped line before them', () => {
    const lines = parseLines([
      '2026-10-13 15:12:00 ERROR tools.terminal: failed',
      '    File "x.py", line 1',
      'Traceback (most recent call last):',
      '2026-10-13 15:12:01 INFO agent.run: next'
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]!.message).toBe('failed\n    File "x.py", line 1\nTraceback (most recent call last):')
    expect(lines[0]!.raw).toContain('Traceback')
    expect(lines[1]!.index).toBe(1)
  })
  it('does not merge anything in a log that has no timestamps', () => {
    const lines = parseLines(['one', 'two', 'ERROR three'])
    expect(lines.map((l) => l.message)).toEqual(['one', 'two', 'three'])
  })
  it('starts with a continuation line as its own line', () => {
    expect(parseLines(['   leftover', '2026-10-13 15:12:00 INFO a: b'])).toHaveLength(2)
  })
})

const mk = (raws: string[]) => parseLines(raws)
const base: LogFilter = { levels: ['INFO', 'WARNING', 'ERROR', 'CRITICAL', 'UNKNOWN'], component: 'all', rangeS: null, query: '' }

describe('filterLines', () => {
  const lines = mk([
    'no timestamp or level',
    '2026-10-13 15:00:00 DEBUG agent.tools: loaded',
    '2026-10-13 15:10:00 INFO agent.run: started',
    '2026-10-13 15:20:00 ERROR tools.terminal: failed hard',
    '2026-10-13 15:30:00 WARNING gateway.run: slow'
  ])
  it('hides the levels that are off, DEBUG by default, and keeps unknown lines', () => {
    expect(filterLines(lines, base, 0, 0).map((l) => l.level)).toEqual(['UNKNOWN', 'INFO', 'ERROR', 'WARNING'])
    expect(filterLines(lines, { ...base, levels: ['ERROR'] }, 0, 0).map((l) => l.level)).toEqual(['ERROR'])
  })
  it('filters by component and by search text, ignoring case', () => {
    expect(filterLines(lines, { ...base, component: 'gateway.run' }, 0, 0)).toHaveLength(1)
    expect(filterLines(lines, { ...base, query: 'FAILED' }, 0, 0).map((l) => l.message)).toEqual(['failed hard'])
  })
  it('filters by a range counted back from now, using the server offset, and keeps lines without a time', () => {
    const off = 7 * 3600 // the server clock is UTC+7
    const nowEpoch = Date.UTC(2026, 9, 13, 15, 35, 0) / 1000 - off
    const out = filterLines(lines, { ...base, rangeS: 900 }, nowEpoch, off)
    expect(out.map((l) => l.level)).toEqual(['UNKNOWN', 'WARNING'])
  })
  it('gives every component once, sorted', () => {
    expect(componentsOf(lines)).toEqual(['agent.run', 'agent.tools', 'gateway.run', 'tools.terminal'])
  })
})

describe('serverOffset', () => {
  it('works out the server time zone from the file time and the last line, in quarter hours', () => {
    const ls = mk(['2026-10-13 15:00:00 INFO a: x', '2026-10-13 15:30:07 INFO a: y'])
    const mtime = Date.UTC(2026, 9, 13, 8, 30, 9) / 1000 // UTC 08:30:09 is 15:30:09 at UTC+7
    expect(serverOffset(ls, mtime)).toBe(7 * 3600)
  })
  it('is zero without a timestamped line or without a file time', () => {
    expect(serverOffset(mk(['plain']), 1000)).toBe(0)
    expect(serverOffset(mk(['2026-10-13 15:00:00 INFO a: x']), null)).toBe(0)
  })
})

describe('splitMatches', () => {
  it('splits text around the matches of a query', () => {
    expect(splitMatches('Failed hard, failed again', 'failed')).toEqual([
      { text: 'Failed', hit: true },
      { text: ' hard, ', hit: false },
      { text: 'failed', hit: true },
      { text: ' again', hit: false }
    ])
    expect(splitMatches('plain', '')).toEqual([{ text: 'plain', hit: false }])
    expect(splitMatches('plain', 'zz')).toEqual([{ text: 'plain', hit: false }])
  })
})
