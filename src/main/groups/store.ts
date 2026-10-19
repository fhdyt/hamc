import type Database from 'better-sqlite3'
import { ENTRIES_PER_GROUP, type GroupEntry, type GroupEntryStatus, type GroupRoom } from '@shared/groups'

/*
 * Rooms, their members and the room log of the connection (app.db migration 6). Kept on this computer only, as Hermes
 * Desktop keeps its room log on the desktop; on the VPS each member just has its own `Group: <id>` session.
 */

interface RoomRow {
  group_id: string
  name: string
  needs_you: number
  created_at: number
  updated_at: number
}

export interface GroupMemberRow {
  profile: string
  sessionId: string | null
  /** The newest seq of the room log this member's session was shown. */
  seenSeq: number
}

export class GroupStore {
  constructor(
    private readonly db: Database.Database,
    private readonly connectionId: () => number | null
  ) {}

  private conn(): number {
    const id = this.connectionId()
    if (id === null) throw new Error('No connection is saved.')
    return id
  }

  private toRoom(c: number, r: RoomRow): GroupRoom {
    const members = (this.db.prepare('SELECT profile FROM group_members WHERE connection_id = ? AND group_id = ? ORDER BY position').all(c, r.group_id) as { profile: string }[]).map((m) => m.profile)
    const last = this.db.prepare("SELECT ts, author, text FROM group_entries WHERE connection_id = ? AND group_id = ? AND status = 'ok' ORDER BY seq DESC LIMIT 1").get(c, r.group_id) as { ts: number; author: string; text: string } | undefined
    return { id: r.group_id, name: r.name, members, needsYou: r.needs_you === 1, createdAt: r.created_at, updatedAt: r.updated_at, last: last ? { ts: last.ts, author: last.author, text: last.text.slice(0, 200) } : null }
  }

  /** Every room, the one with the newest activity first. */
  list(): GroupRoom[] {
    const c = this.connectionId()
    if (c === null) return []
    const rows = this.db.prepare('SELECT * FROM group_rooms WHERE connection_id = ?').all(c) as RoomRow[]
    const rooms = rows.map((r) => this.toRoom(c, r))
    const at = (r: GroupRoom): number => Math.max(r.updatedAt, r.last?.ts ?? 0)
    return rooms.sort((a, b) => at(b) - at(a) || a.name.localeCompare(b.name))
  }

  get(id: string): GroupRoom | null {
    const c = this.connectionId()
    if (c === null) return null
    const r = this.db.prepare('SELECT * FROM group_rooms WHERE connection_id = ? AND group_id = ?').get(c, id) as RoomRow | undefined
    return r ? this.toRoom(c, r) : null
  }

  create(id: string, name: string, members: string[], now = Date.now()): GroupRoom {
    const c = this.conn()
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO group_rooms (connection_id, group_id, name, needs_you, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(c, id, name, now, now)
      const add = this.db.prepare('INSERT INTO group_members (connection_id, group_id, profile, position, session_id, seen_seq) VALUES (?, ?, ?, ?, NULL, 0)')
      members.forEach((p, i) => add.run(c, id, p, i))
    })()
    return this.get(id)!
  }

  /** Renames a room or changes its members; kept members keep their session and what they saw. */
  update(id: string, patch: { name?: string; members?: string[] }, now = Date.now()): GroupRoom | null {
    const c = this.connectionId()
    if (c === null || !this.get(id)) return null
    this.db.transaction(() => {
      if (patch.name !== undefined) this.db.prepare('UPDATE group_rooms SET name = ?, updated_at = ? WHERE connection_id = ? AND group_id = ?').run(patch.name, now, c, id)
      if (patch.members !== undefined) {
        const keep = patch.members
        const old = this.members(id).map((m) => m.profile)
        const drop = this.db.prepare('DELETE FROM group_members WHERE connection_id = ? AND group_id = ? AND profile = ?')
        for (const p of old) if (!keep.includes(p)) drop.run(c, id, p)
        const put = this.db.prepare('INSERT INTO group_members (connection_id, group_id, profile, position, session_id, seen_seq) VALUES (?, ?, ?, ?, NULL, 0) ON CONFLICT(connection_id, group_id, profile) DO UPDATE SET position = excluded.position')
        keep.forEach((p, i) => put.run(c, id, p, i))
        this.db.prepare('UPDATE group_rooms SET updated_at = ? WHERE connection_id = ? AND group_id = ?').run(now, c, id)
      }
    })()
    return this.get(id)
  }

  remove(id: string): void {
    const c = this.connectionId()
    if (c === null) return
    this.db.transaction(() => {
      for (const t of ['group_entries', 'group_members', 'group_rooms']) this.db.prepare(`DELETE FROM ${t} WHERE connection_id = ? AND group_id = ?`).run(c, id)
    })()
  }

  /** Entries oldest first: the newest `limit` (300 by default), or the ones before `before`. */
  entries(id: string, opts: { before?: number; limit?: number } = {}): GroupEntry[] {
    const c = this.connectionId()
    if (c === null) return []
    const limit = Math.max(1, Math.min(opts.limit ?? 300, ENTRIES_PER_GROUP))
    const rows = this.db
      .prepare('SELECT seq, author, text, status, ts FROM group_entries WHERE connection_id = ? AND group_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?')
      .all(c, id, opts.before ?? Number.MAX_SAFE_INTEGER, limit) as GroupEntry[]
    return rows.reverse()
  }

  lastSeq(id: string): number {
    const c = this.connectionId()
    if (c === null) return 0
    const r = this.db.prepare('SELECT MAX(seq) AS s FROM group_entries WHERE connection_id = ? AND group_id = ?').get(c, id) as { s: number | null }
    return r.s ?? 0
  }

  addEntry(id: string, author: string, text: string, status: GroupEntryStatus, ts = Date.now()): GroupEntry {
    const c = this.conn()
    const seq = this.lastSeq(id) + 1
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO group_entries (connection_id, group_id, seq, author, text, status, ts) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c, id, seq, author, text, status, ts)
      this.db.prepare('DELETE FROM group_entries WHERE connection_id = ? AND group_id = ? AND seq <= ?').run(c, id, seq - ENTRIES_PER_GROUP)
    })()
    return { seq, author, text, status, ts }
  }

  members(id: string): GroupMemberRow[] {
    const c = this.connectionId()
    if (c === null) return []
    return this.db.prepare('SELECT profile, session_id AS sessionId, seen_seq AS seenSeq FROM group_members WHERE connection_id = ? AND group_id = ? ORDER BY position').all(c, id) as GroupMemberRow[]
  }

  setSession(id: string, profile: string, sessionId: string | null): void {
    const c = this.connectionId()
    if (c !== null) this.db.prepare('UPDATE group_members SET session_id = ? WHERE connection_id = ? AND group_id = ? AND profile = ?').run(sessionId, c, id, profile)
  }

  setSeen(id: string, profile: string, seq: number): void {
    const c = this.connectionId()
    if (c !== null) this.db.prepare('UPDATE group_members SET seen_seq = ? WHERE connection_id = ? AND group_id = ? AND profile = ?').run(seq, c, id, profile)
  }

  setNeedsYou(id: string, flag: boolean): void {
    const c = this.connectionId()
    if (c !== null) this.db.prepare('UPDATE group_rooms SET needs_you = ? WHERE connection_id = ? AND group_id = ?').run(flag ? 1 : 0, c, id)
  }

  /** Settings → Data → Clear room history: the log goes, the rooms and the members' sessions stay. */
  clearEntries(): void {
    const c = this.connectionId()
    if (c === null) return
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM group_entries WHERE connection_id = ?').run(c)
      this.db.prepare('UPDATE group_members SET seen_seq = 0 WHERE connection_id = ?').run(c)
      this.db.prepare('UPDATE group_rooms SET needs_you = 0 WHERE connection_id = ?').run(c)
    })()
  }

  forget(connectionId: number): void {
    for (const t of ['group_entries', 'group_members', 'group_rooms']) this.db.prepare(`DELETE FROM ${t} WHERE connection_id = ?`).run(connectionId)
  }
}
