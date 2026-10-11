import { describe, expect, it } from 'vitest'
import { buildCommand, shQuote } from '../../src/main/connection/quote'
import { shSplit } from '../helpers/shellSplit'

describe('shQuote', () => {
  it('wraps in single quotes', () => {
    expect(shQuote('abc')).toBe("'abc'")
  })

  it('escapes embedded single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })

  it('rejects NUL bytes', () => {
    expect(() => shQuote('a\0b')).toThrow(/NUL/)
  })
})

describe('buildCommand', () => {
  it('rejects an empty argv', () => {
    expect(() => buildCommand([])).toThrow()
  })

  it('round-trips hostile arguments', () => {
    const argv = [
      'echo',
      'a b',
      "it's",
      '$(rm -rf ~)',
      '`id`',
      'x; y && z | w',
      'line1\nline2',
      '',
      'héllo ✓',
      '"quoted"',
      '\\back\\slash',
      '*'
    ]
    expect(shSplit(buildCommand(argv))).toEqual(argv)
  })
})
