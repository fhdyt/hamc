import { describe, expect, it, vi } from 'vitest'
import { LineSplitter } from '../../src/main/collector/lines'
import { EventRouter } from '../../src/main/collector/router'
import { sampleAgents } from '../helpers/samples'

describe('LineSplitter', () => {
  it('joins fragments and drops blank lines', () => {
    const s = new LineSplitter()
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
    expect(s.push(':2}\r\n\n')).toEqual(['{"b":2}'])
  })

  it('discards a runaway line instead of growing forever', () => {
    const s = new LineSplitter(10)
    expect(s.push('x'.repeat(50))).toEqual([])
    expect(s.push('ok\n')).toEqual(['ok'])
  })
})

describe('EventRouter', () => {
  it('emits valid events and logs invalid ones', () => {
    const log = vi.fn()
    const r = new EventRouter(log)
    const got: unknown[] = []
    r.on('event', (e) => got.push(e))
    r.handleLine(JSON.stringify({ type: 'agents', ts: 1, profile: null, data: sampleAgents() }))
    r.handleLine('garbage')
    expect(got).toHaveLength(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0]).toMatch(/invalid collector line/)
  })
})
