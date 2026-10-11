import { describe, expect, it } from 'vitest'
import { classifyConnectError, friendlyMessage } from '../../src/main/connection/errors'

describe('classifyConnectError', () => {
  it.each([
    [{ level: 'client-authentication' }, 'auth'],
    [{ level: 'client-timeout' }, 'timeout'],
    [{ code: 'ETIMEDOUT' }, 'timeout'],
    [{ code: 'ECONNREFUSED' }, 'unreachable'],
    [{ code: 'ENOTFOUND' }, 'unreachable'],
    [{ code: 'EHOSTUNREACH' }, 'unreachable'],
    [{ code: 'ENETUNREACH' }, 'unreachable'],
    [{ code: 'ECONNRESET' }, 'unreachable'],
    [{ code: 'EOTHER' }, 'unknown'],
    [{}, 'unknown']
  ] as const)('%j -> %s', (err, kind) => {
    expect(classifyConnectError(err)).toBe(kind)
  })
})

describe('friendlyMessage', () => {
  it('names the host and port for network errors', () => {
    expect(friendlyMessage('unreachable', 'h', 22, 'x')).toContain('h:22')
    expect(friendlyMessage('timeout', 'h', 22, 'x')).toContain('h:22')
  })
  it('does not echo credentials for auth errors', () => {
    expect(friendlyMessage('auth', 'h', 22, 'All configured authentication methods failed')).toBe(
      'The server rejected the username or password.'
    )
  })
  it('falls back to the raw message', () => {
    expect(friendlyMessage('unknown', 'h', 22, 'boom')).toBe('boom')
  })
})
