import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../../src/main/store/settingsStore'
import { SETTINGS_DEFAULTS } from '@shared/settings'

let store: SettingsStore
beforeEach(() => {
  store = new SettingsStore(':memory:')
})
afterEach(() => store.close())

const conn = { name: 'prod', host: '10.0.0.1', port: 22, username: 'root', remember: true }

describe('settings', () => {
  it('returns defaults and persists changes', () => {
    expect(store.getSetting('ui.zoom')).toBe(SETTINGS_DEFAULTS['ui.zoom'])
    store.setSetting('ui.zoom', 1.2)
    store.setSetting('window.bounds', { width: 900, height: 600 })
    expect(store.getSetting('ui.zoom')).toBe(1.2)
    expect(store.allSettings()['window.bounds']).toEqual({ width: 900, height: 600 })
  })

  it('rejects a value that fails the schema', () => {
    expect(() => store.setSetting('ui.zoom', 9)).toThrow()
  })
})

describe('connections', () => {
  it('starts empty', () => {
    expect(store.getConnection()).toBeNull()
  })

  it('stores a connection with an encrypted password blob', () => {
    const id = store.upsertConnection({ ...conn, passwordEnc: Buffer.from('enc') })
    const c = store.getConnection()!
    expect(c).toMatchObject({ id, host: '10.0.0.1', port: 22, username: 'root', remember: true, hasPassword: true })
    expect(store.getPasswordEnc()!.toString()).toBe('enc')
  })

  it('keeps the old password when passwordEnc is undefined', () => {
    store.upsertConnection({ ...conn, passwordEnc: Buffer.from('enc') })
    store.upsertConnection({ ...conn, port: 2222 })
    expect(store.getConnection()!.port).toBe(2222)
    expect(store.getPasswordEnc()!.toString()).toBe('enc')
  })

  it('clears the password when remember is false', () => {
    store.upsertConnection({ ...conn, passwordEnc: Buffer.from('enc') })
    store.upsertConnection({ ...conn, remember: false })
    expect(store.getConnection()!.hasPassword).toBe(false)
    expect(store.getPasswordEnc()).toBeNull()
  })

  it('keeps a single connection row', () => {
    const a = store.upsertConnection(conn)
    const b = store.upsertConnection({ ...conn, host: '10.0.0.2' })
    expect(b).toBe(a)
    expect(store.getConnection()!.host).toBe('10.0.0.2')
  })

  it('forget removes the connection, its pins and its host key', () => {
    const id = store.upsertConnection(conn)
    store.trustHost('10.0.0.1', 22, 'ssh-ed25519', 'SHA256:abc')
    store.setPins(id, ['a'])
    store.forgetConnection()
    expect(store.getConnection()).toBeNull()
    expect(store.getKnownHost('10.0.0.1', 22)).toBeNull()
    expect(store.getPins(id)).toEqual([])
    expect(store.pinsInitialized(id)).toBe(false)
  })
})

describe('known hosts', () => {
  it('returns null for unknown hosts and stores trusted ones', () => {
    expect(store.getKnownHost('h', 22)).toBeNull()
    store.trustHost('h', 22, 'ssh-ed25519', 'SHA256:abc', 1000)
    expect(store.getKnownHost('h', 22)).toEqual({ algo: 'ssh-ed25519', fingerprint: 'SHA256:abc', firstSeenAt: 1000 })
  })

  it('replaces the fingerprint when the user trusts a new key', () => {
    store.trustHost('h', 22, 'ssh-ed25519', 'SHA256:old', 1)
    store.trustHost('h', 22, 'ssh-ed25519', 'SHA256:new', 2)
    expect(store.getKnownHost('h', 22)!.fingerprint).toBe('SHA256:new')
  })

  it('exposes the fingerprint on the saved connection', () => {
    store.upsertConnection(conn)
    store.trustHost('10.0.0.1', 22, 'ssh-ed25519', 'SHA256:abc')
    expect(store.getConnection()!.fingerprint).toBe('SHA256:abc')
  })
})

describe('pins', () => {
  it('keeps order and marks the list initialized even when empty', () => {
    const id = store.upsertConnection(conn)
    expect(store.pinsInitialized(id)).toBe(false)
    store.setPins(id, ['b', 'a', 'c'])
    expect(store.getPins(id)).toEqual(['b', 'a', 'c'])
    store.setPins(id, [])
    expect(store.getPins(id)).toEqual([])
    expect(store.pinsInitialized(id)).toBe(true)
  })
})

describe('vault path', () => {
  it('is saved per connection, can be cleared and goes away with the connection', () => {
    const id = store.upsertConnection(conn)
    expect(store.getVault(id)).toBeNull()
    store.setVault(id, '/home/u/vault')
    expect(store.getVault(id)).toBe('/home/u/vault')
    store.setVault(id, '~/other')
    expect(store.getVault(id)).toBe('~/other')
    store.setVault(id, null)
    expect(store.getVault(id)).toBeNull()
    store.setVault(id, '/again')
    store.forgetConnection()
    expect(store.getVault(id)).toBeNull()
  })
})

describe('migrations', () => {
  it('is idempotent across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-db-'))
    const path = join(dir, 'app.db')
    try {
      const a = new SettingsStore(path)
      a.setSetting('ui.density', 'comfortable')
      a.close()
      const b = new SettingsStore(path)
      expect(b.getSetting('ui.density')).toBe('comfortable')
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
