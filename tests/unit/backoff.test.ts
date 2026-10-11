import { describe, expect, it } from 'vitest'
import { backoffDelay } from '../../src/main/connection/backoff'

describe('backoffDelay', () => {
  it('follows 1s, 2s, 5s, 10s and caps at 30s', () => {
    expect([0, 1, 2, 3, 4, 5, 99].map(backoffDelay)).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000])
  })
  it('treats negative attempts as the first', () => {
    expect(backoffDelay(-3)).toBe(1000)
  })
})
