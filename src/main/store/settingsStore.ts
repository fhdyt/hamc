import Database from 'better-sqlite3'
import type { SavedConnection } from '@shared/ipc'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA, type SettingsMap } from '@shared/settings'

const MIGRATIONS: string[] = [
  `CREATE TABLE connections (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     host TEXT NOT NULL,
     port INTEGER NOT NULL,
     username TEXT NOT NULL,
     remember INTEGER NOT NULL DEFAULT 1,
     password_enc BLOB,
     last_connected_at INTEGER
   );
   CREATE TABLE known_hosts (
     host TEXT NOT NULL,
     port INTEGER NOT NULL,
     algo TEXT NOT NULL,
     fingerprint TEXT NOT NULL,
     first_seen_at INTEGER NOT NULL,
     PRIMARY KEY (host, port)
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE agent_pins (
     connection_id INTEGER NOT NULL,
     profile TEXT NOT NULL,
     position INTEGER NOT NULL,
     PRIMARY KEY (connection_id, profile)
   );`
]

export interface UpsertConnection {
  name: string
  host: string
  port: number
  username: string
  remember: boolean
  passwordEnc?: Buffer | null
}

export interface KnownHost {
  algo: string
  fingerprint: string
  firstSeenAt: number
}

interface ConnRow {
  id: number
  name: string
  host: string
  port: number
  username: string
  remember: number
  password_enc: Buffer | null
  last_connected_at: number | null
}

export class SettingsStore {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
    const current = row.v ?? 0
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[i]!)
        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1)
      })()
    }
  }

  getSetting<K extends keyof SettingsMap>(key: K): SettingsMap[K] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return SETTINGS_DEFAULTS[key]
    const parsed = (SETTINGS_SCHEMA[key] as { safeParse(v: unknown): { success: boolean; data?: unknown } }).safeParse(JSON.parse(row.value))
    return parsed.success ? (parsed.data as SettingsMap[K]) : SETTINGS_DEFAULTS[key]
  }

  setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): void {
    const checked = (SETTINGS_SCHEMA[key] as { parse(v: unknown): unknown }).parse(value)
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(checked))
  }

  allSettings(): SettingsMap {
    const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS }
    for (const key of Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsMap)[]) out[key] = this.getSetting(key)
    return out as unknown as SettingsMap
  }

  private connRow(): ConnRow | undefined {
    return this.db.prepare('SELECT * FROM connections ORDER BY id LIMIT 1').get() as ConnRow | undefined
  }

  getConnection(): SavedConnection | null {
    const r = this.connRow()
    if (!r) return null
    const kh = this.getKnownHost(r.host, r.port)
    return {
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      username: r.username,
      remember: r.remember === 1,
      hasPassword: r.password_enc !== null,
      lastConnectedAt: r.last_connected_at,
      fingerprint: kh?.fingerprint ?? null
    }
  }

  getPasswordEnc(): Buffer | null {
    return this.connRow()?.password_enc ?? null
  }

  upsertConnection(input: UpsertConnection): number {
    const existing = this.connRow()
    const passwordEnc = !input.remember
      ? null
      : input.passwordEnc === undefined
        ? (existing?.password_enc ?? null)
        : input.passwordEnc
    if (existing) {
      this.db
        .prepare('UPDATE connections SET name=?, host=?, port=?, username=?, remember=?, password_enc=? WHERE id=?')
        .run(input.name, input.host, input.port, input.username, input.remember ? 1 : 0, passwordEnc, existing.id)
      return existing.id
    }
    const res = this.db
      .prepare('INSERT INTO connections (name, host, port, username, remember, password_enc) VALUES (?,?,?,?,?,?)')
      .run(input.name, input.host, input.port, input.username, input.remember ? 1 : 0, passwordEnc)
    return Number(res.lastInsertRowid)
  }

  touchConnected(id: number, ts: number): void {
    this.db.prepare('UPDATE connections SET last_connected_at = ? WHERE id = ?').run(ts, id)
  }

  forgetConnection(): void {
    const r = this.connRow()
    if (!r) return
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_pins WHERE connection_id = ?').run(r.id)
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`pins.initialized.${r.id}`)
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`brain.vault.${r.id}`)
      this.db.prepare('DELETE FROM known_hosts WHERE host = ? AND port = ?').run(r.host, r.port)
      this.db.prepare('DELETE FROM connections WHERE id = ?').run(r.id)
    })()
  }

  getKnownHost(host: string, port: number): KnownHost | null {
    const r = this.db
      .prepare('SELECT algo, fingerprint, first_seen_at AS firstSeenAt FROM known_hosts WHERE host = ? AND port = ?')
      .get(host, port) as KnownHost | undefined
    return r ?? null
  }

  trustHost(host: string, port: number, algo: string, fingerprint: string, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO known_hosts (host, port, algo, fingerprint, first_seen_at) VALUES (?,?,?,?,?)
         ON CONFLICT(host, port) DO UPDATE SET algo = excluded.algo, fingerprint = excluded.fingerprint`
      )
      .run(host, port, algo, fingerprint, now)
  }

  getPins(connectionId: number): string[] {
    const rows = this.db
      .prepare('SELECT profile FROM agent_pins WHERE connection_id = ? ORDER BY position')
      .all(connectionId) as { profile: string }[]
    return rows.map((r) => r.profile)
  }

  setPins(connectionId: number, profiles: string[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM agent_pins WHERE connection_id = ?').run(connectionId)
      const ins = this.db.prepare('INSERT INTO agent_pins (connection_id, profile, position) VALUES (?,?,?)')
      profiles.forEach((p, i) => ins.run(connectionId, p, i))
      this.db
        .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(`pins.initialized.${connectionId}`, 'true')
    })()
  }

  getVault(connectionId: number): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`brain.vault.${connectionId}`) as { value: string } | undefined
    if (!row) return null
    try {
      const v: unknown = JSON.parse(row.value)
      return typeof v === 'string' && v.length > 0 ? v : null
    } catch {
      return null
    }
  }

  setVault(connectionId: number, path: string | null): void {
    const key = `brain.vault.${connectionId}`
    if (path === null) this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    else this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(path))
  }

  pinsInitialized(connectionId: number): boolean {
    return this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`pins.initialized.${connectionId}`) !== undefined
  }

  close(): void {
    this.db.close()
  }
}
