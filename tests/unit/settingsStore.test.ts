import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { SettingsStore, TargetTakenError } from '../../src/main/store/settingsStore'
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

  it('resets every setting to its default and keeps the window bounds, the connection and what belongs to it', () => {
    const id = store.upsertConnection({ ...conn, secretEnc: Buffer.from('enc') })
    store.setPins(id, ['scout'])
    store.setVault(id, '/home/hermes/vault')
    store.setSetting('ui.zoom', 1.3)
    store.setSetting('dashboard.chatW', 500)
    store.setSetting('dashboard.graphTab', 'agents')
    store.setSetting('window.bounds', { width: 900, height: 600 })
    const after = store.resetSettings()
    expect(after['ui.zoom']).toBe(SETTINGS_DEFAULTS['ui.zoom'])
    expect(after['dashboard.chatW']).toBe(SETTINGS_DEFAULTS['dashboard.chatW'])
    expect(store.getSetting('dashboard.graphTab')).toBe('brain')
    expect(store.getSetting('window.bounds')).toEqual({ width: 900, height: 600 })
    expect(store.getConnection()).toMatchObject({ id, host: '10.0.0.1' })
    expect(store.getPins(id)).toEqual(['scout'])
    expect(store.getVault(id)).toBe('/home/hermes/vault')
  })
})

describe('connections', () => {
  it('starts empty', () => {
    expect(store.getConnection()).toBeNull()
  })

  it('stores a connection with an encrypted password blob', () => {
    const id = store.upsertConnection({ ...conn, secretEnc: Buffer.from('enc') })
    const c = store.getConnection()!
    expect(c).toMatchObject({ id, host: '10.0.0.1', port: 22, username: 'root', remember: true, hasSecret: true })
    expect(store.getSecretEnc()!.toString()).toBe('enc')
  })

  it('keeps the old password when secretEnc is undefined', () => {
    const id = store.upsertConnection({ ...conn, secretEnc: Buffer.from('enc') })
    store.upsertConnection({ ...conn, id, port: 2222 })
    expect(store.getConnection()!.port).toBe(2222)
    expect(store.getSecretEnc()!.toString()).toBe('enc')
  })

  it('clears the password when remember is false', () => {
    store.upsertConnection({ ...conn, secretEnc: Buffer.from('enc') })
    store.upsertConnection({ ...conn, remember: false })
    expect(store.getConnection()!.hasSecret).toBe(false)
    expect(store.getSecretEnc()).toBeNull()
  })

  it('reads a connection saved before migration 5 as a password connection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-store-old-'))
    const file = join(dir, 'app.db')
    const old = new Database(file)
    old.exec(`CREATE TABLE connections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
                username TEXT NOT NULL, remember INTEGER NOT NULL DEFAULT 1, password_enc BLOB, last_connected_at INTEGER);
              CREATE TABLE known_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, algo TEXT NOT NULL, fingerprint TEXT NOT NULL, first_seen_at INTEGER NOT NULL, PRIMARY KEY (host, port));
              CREATE TABLE schema_version (version INTEGER NOT NULL);
              INSERT INTO schema_version VALUES (1), (2), (3), (4);`)
    old.prepare('INSERT INTO connections (name, host, port, username, remember, password_enc) VALUES (?,?,?,?,?,?)').run('prod', '10.0.0.1', 22, 'root', 1, Buffer.from('enc'))
    old.close()
    const s = new SettingsStore(file)
    expect(s.getConnection()).toMatchObject({ host: '10.0.0.1', authMethod: 'password', keyPath: null, hasSecret: true })
    s.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('stores the key method with its path and passphrase, and keeps the passphrase while both stay the same', () => {
    store.upsertConnection({ ...conn, authMethod: 'key', keyPath: '/home/me/.ssh/id_ed25519', secretEnc: Buffer.from('pp') })
    expect(store.getConnection()).toMatchObject({ authMethod: 'key', keyPath: '/home/me/.ssh/id_ed25519', hasSecret: true })
    store.upsertConnection({ ...conn, authMethod: 'key', keyPath: '/home/me/.ssh/id_ed25519' })
    expect(store.getSecretEnc()!.toString()).toBe('pp')
  })

  it('drops the secret when the method or the key file changes', () => {
    store.upsertConnection({ ...conn, authMethod: 'key', keyPath: '/a', secretEnc: Buffer.from('pp') })
    store.upsertConnection({ ...conn, authMethod: 'key', keyPath: '/b' })
    expect(store.getConnection()).toMatchObject({ keyPath: '/b', hasSecret: false })
    store.upsertConnection({ ...conn, authMethod: 'key', keyPath: '/b', secretEnc: Buffer.from('pp') })
    store.upsertConnection({ ...conn, authMethod: 'password' })
    expect(store.getConnection()).toMatchObject({ authMethod: 'password', keyPath: null, hasSecret: false })
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

describe('server list', () => {
  it('adds a row per target and lists the newest connected first', () => {
    const a = store.upsertConnection(conn)
    const b = store.upsertConnection({ ...conn, host: '10.0.0.2', name: 'lab' })
    expect(b).not.toBe(a)
    store.touchConnected(a, 100)
    store.touchConnected(b, 200)
    expect(store.listConnections().map((c) => c.id)).toEqual([b, a])
    expect(store.getConnection(b)).toMatchObject({ label: 'lab', name: 'lab' })
    expect(store.getConnection(a)).toMatchObject({ label: 'prod', name: 'prod' })
  })

  it('lists never-connected rows last', () => {
    const a = store.upsertConnection(conn)
    const b = store.upsertConnection({ ...conn, host: '10.0.0.2' })
    store.touchConnected(b, 5)
    expect(store.listConnections().map((c) => c.id)).toEqual([b, a])
  })

  it('shows user@host when the label is empty', () => {
    const id = store.upsertConnection({ ...conn, name: '' })
    expect(store.getConnection(id)).toMatchObject({ label: '', name: 'root@10.0.0.1' })
  })

  it('finds a row by its target', () => {
    const a = store.upsertConnection(conn)
    expect(store.findConnection('10.0.0.1', 22, 'root')!.id).toBe(a)
    expect(store.findConnection('10.0.0.1', 22, 'other')).toBeNull()
    expect(store.upsertConnection({ ...conn, name: undefined as never })).toBe(a)
  })

  it('updates by id and refuses an address another row has', () => {
    const a = store.upsertConnection(conn)
    const b = store.upsertConnection({ ...conn, host: '10.0.0.2' })
    expect(store.upsertConnection({ ...conn, id: a, port: 2200 })).toBe(a)
    expect(store.getConnection(a)!.port).toBe(2200)
    expect(() => store.upsertConnection({ ...conn, id: a, host: '10.0.0.2' })).toThrow(TargetTakenError)
    expect(store.getConnection(b)!.host).toBe('10.0.0.2')
    expect(store.getConnection(a)!.host).toBe('10.0.0.1')
  })

  it('keeps the label when the name is absent', () => {
    const a = store.upsertConnection(conn)
    store.upsertConnection({ ...conn, id: a, name: undefined })
    expect(store.getConnection(a)!.label).toBe('prod')
  })

  it('follows the active row, the newest one by default', () => {
    const a = store.upsertConnection(conn)
    const b = store.upsertConnection({ ...conn, host: '10.0.0.2', secretEnc: Buffer.from('b') })
    store.touchConnected(b, 10)
    expect(store.getConnection()!.id).toBe(b)
    expect(store.activeId()).toBe(b)
    store.setActive(a)
    expect(store.getConnection()!.id).toBe(a)
    expect(store.activeId()).toBe(a)
    expect(store.getSecretEnc()).toBeNull()
    expect(store.getSecretEnc(b)!.toString()).toBe('b')
    store.setActive(null)
    expect(store.getConnection()).toBeNull()
    expect(store.activeId()).toBeNull()
    store.setActive(undefined)
    expect(store.getConnection()!.id).toBe(b)
  })

  it('renames and checks the label', () => {
    const a = store.upsertConnection(conn)
    store.renameConnection(a, '  lab  ')
    expect(store.getConnection(a)!.label).toBe('lab')
    expect(() => store.renameConnection(a, 'x'.repeat(41))).toThrow()
    expect(() => store.renameConnection(a, 'a\u0007b')).toThrow()
    expect(() => store.upsertConnection({ ...conn, id: a, name: 'x'.repeat(41) })).toThrow()
  })

  it('forget(id) drops only that row and keeps a host key another row uses', () => {
    const a = store.upsertConnection(conn)
    const b = store.upsertConnection({ ...conn, username: 'hermes' })
    store.trustHost('10.0.0.1', 22, 'ssh-ed25519', 'SHA256:abc')
    store.setPins(a, ['x'])
    store.setPins(b, ['y'])
    store.setActive(a)
    store.forgetConnection(a)
    expect(store.getConnection(a)).toBeNull()
    expect(store.getConnection()!.id).toBe(b)
    expect(store.getPins(b)).toEqual(['y'])
    expect(store.getPins(a)).toEqual([])
    expect(store.getKnownHost('10.0.0.1', 22)).not.toBeNull()
    store.forgetConnection(b)
    expect(store.getKnownHost('10.0.0.1', 22)).toBeNull()
  })

  it('migration 7 clears automatic names and keeps real labels', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-store-m7-'))
    const file = join(dir, 'app.db')
    const first = new SettingsStore(file)
    first.upsertConnection({ ...conn, name: 'prod' })
    first.upsertConnection({ ...conn, host: '10.0.0.2', name: '' })
    first.close()
    const raw = new Database(file)
    raw.exec(`UPDATE connections SET name = username || '@' || host WHERE host = '10.0.0.2';
              DROP INDEX idx_connections_target;
              DELETE FROM schema_version WHERE version = 7;`)
    raw.close()
    const s = new SettingsStore(file)
    expect(s.findConnection('10.0.0.2', 22, 'root')).toMatchObject({ label: '', name: 'root@10.0.0.2' })
    expect(s.findConnection('10.0.0.1', 22, 'root')).toMatchObject({ label: 'prod' })
    s.close()
    rmSync(dir, { recursive: true, force: true })
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
