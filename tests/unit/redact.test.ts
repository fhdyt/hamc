import { describe, expect, it } from 'vitest'
import { maskSecrets } from '../../src/renderer/lib/redact'

describe('maskSecrets', () => {
  it('masks bearer tokens and well-known key shapes', () => {
    expect(maskSecrets('Authorization: Bearer abcdef1234567890XYZ')).toBe('Authorization: Bearer [redacted]')
    expect(maskSecrets('key sk-or-v1-0123456789abcdefABCDEF here')).toBe('key [redacted] here')
    expect(maskSecrets('token ghp_0123456789abcdefghij0123 ok')).toBe('token [redacted] ok')
    expect(maskSecrets('slack xoxb-1234567890-abcdefghij')).toBe('slack [redacted]')
    expect(maskSecrets('aws AKIAABCDEFGHIJKLMNOP')).toBe('aws [redacted]')
    expect(maskSecrets('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4 end')).toBe('jwt [redacted] end')
    expect(maskSecrets('bot 123456789:AAFabcdefghijklmnopqrstuvwxyz0123456')).toBe('bot [redacted]')
  })
  it('masks the value of key=value and key: value pairs but keeps the key', () => {
    expect(maskSecrets('api_key=supersecretvalue1')).toBe('api_key=[redacted]')
    expect(maskSecrets('password: "hunter2hunter2"')).toBe('password: "[redacted]"')
    expect(maskSecrets('{"token": "abc123def456"}')).toBe('{"token": "[redacted]"}')
  })
  it('masks very long hex strings but not commit ids or session ids', () => {
    expect(maskSecrets('k ' + 'a1'.repeat(30))).toBe('k [redacted]')
    expect(maskSecrets('commit 0123456789abcdef0123456789abcdef01234567')).toBe('commit 0123456789abcdef0123456789abcdef01234567')
    expect(maskSecrets('session 20261013_151155_fb024c')).toBe('session 20261013_151155_fb024c')
  })
  it('leaves ordinary text alone', () => {
    const text = 'gateway connected to telegram, 3 tools loaded, token budget low, password policy ok'
    expect(maskSecrets(text)).toBe(text)
  })
})
