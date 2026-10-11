import { describe, expect, it } from 'vitest'
import { SecretStore, type SafeStorageLike } from '../../src/main/store/secretStore'

const fake = (over: Partial<SafeStorageLike> = {}): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => {
    const t = b.toString()
    if (!t.startsWith('enc:')) throw new Error('bad blob')
    return t.slice(4)
  },
  ...over
})

describe('SecretStore', () => {
  it('encrypts and decrypts when available', () => {
    const s = new SecretStore(fake(), 'win32')
    expect(s.status()).toEqual({ available: true, reason: null })
    expect(s.decrypt(s.encrypt('hunter2'))).toBe('hunter2')
  })

  it('is unavailable when the OS reports no encryption', () => {
    const s = new SecretStore(fake({ isEncryptionAvailable: () => false }), 'win32')
    expect(s.status().available).toBe(false)
    expect(() => s.encrypt('x')).toThrow()
  })

  it.each(['basic_text', 'unknown'])('refuses the weak linux backend %s', (backend) => {
    const s = new SecretStore(fake({ getSelectedStorageBackend: () => backend }), 'linux')
    const st = s.status()
    expect(st.available).toBe(false)
    expect(st.reason).toMatch(/keyring/i)
  })

  it('accepts a real linux keyring', () => {
    const s = new SecretStore(fake({ getSelectedStorageBackend: () => 'gnome_libsecret' }), 'linux')
    expect(s.status().available).toBe(true)
  })

  it('returns null when decryption fails', () => {
    const s = new SecretStore(fake(), 'win32')
    expect(s.decrypt(Buffer.from('garbage'))).toBeNull()
  })
})
