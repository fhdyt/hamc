import { createHash } from 'node:crypto'
import type { AgentFileKind } from '@shared/agentCfg'
import type { MemoryFileEvent } from '@shared/events'
import { diffCounts, type MemoryAuthor, type MemoryVersion, type MemoryVersionText } from '@shared/memory'
import type { SettingsStore } from '../store/settingsStore'

export interface MemorySnapshotDeps {
  store: Pick<SettingsStore, 'latestSnapshot' | 'addSnapshot' | 'listSnapshots' | 'getSnapshot' | 'clearSnapshots'>
  connectionId: () => number | undefined
  /** Tells the renderer that a file has a new version. */
  changed: (profile: string, file: AgentFileKind) => void
  now?: () => number
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * Local versions of SOUL.md, MEMORY.md and USER.md (F-MEMT-2/3). A version is kept only when the content hash differs
 * from the newest stored one. The author is a guess: the agent's memory tool near the change, a save made in Mission
 * Control, a change found right after connecting (while away), or a later change with no evidence.
 */
export class MemorySnapshots {
  /** Files already seen since this collector stream started: a difference on the first sight happened while away. */
  private seen = new Set<string>()
  /** Hashes of saves in flight from Settings → Agents: the collector may see the new file before the save returns. */
  private expected = new Map<string, { hash: string; until: number }>()

  constructor(private readonly d: MemorySnapshotDeps) {}

  /** A new collector stream: the next event of each file is a baseline again. */
  reset(): void {
    this.seen.clear()
  }

  private add(profile: string, file: AgentFileKind, hash: string, text: string, author: MemoryAuthor, sessionId: string | null, mtime: number | null): boolean {
    const conn = this.d.connectionId()
    if (conn === undefined) return false
    const latest = this.d.store.latestSnapshot(conn, profile, file)
    if (latest?.hash === hash) return false
    const counts = diffCounts(file, latest?.content ?? '', text)
    this.d.store.addSnapshot({ connectionId: conn, profile, file, takenAt: (this.d.now ?? Date.now)(), hash, content: text, author: latest ? author : 'first', sessionId, mtime, ...counts })
    this.d.changed(profile, file)
    return true
  }

  ingest(ev: MemoryFileEvent): void {
    const key = `${ev.profile}:${ev.file}`
    const first = !this.seen.has(key)
    this.seen.add(key)
    const mine = this.expected.get(key)
    const ours = mine !== undefined && mine.hash === ev.hash && mine.until > (this.d.now ?? Date.now)()
    const author: MemoryAuthor = ours ? 'you' : ev.agentTs !== null ? 'agent' : first ? 'away' : 'other'
    this.add(ev.profile, ev.file, ev.hash, ev.text, author, author === 'agent' ? ev.agentSession : null, ev.mtime)
  }

  /** Called before a save through Settings → Agents writes `text`, so a collector event with that content counts as yours. */
  expectSave(profile: string, file: AgentFileKind, text: string): void {
    this.expected.set(`${profile}:${file}`, { hash: sha256(text), until: (this.d.now ?? Date.now)() + 120_000 })
  }

  /** A save through Settings → Agents (the text the server now holds). */
  recordSave(profile: string, file: AgentFileKind, text: string, mtime: number | null): void {
    this.seen.add(`${profile}:${file}`)
    this.add(profile, file, sha256(text), text, 'you', null, mtime)
  }

  versions(profile: string, file: AgentFileKind): MemoryVersion[] {
    const conn = this.d.connectionId()
    if (conn === undefined) return []
    return this.d.store.listSnapshots(conn, profile, file).map((r) => ({ ...r, file, author: r.author as MemoryAuthor }))
  }

  version(id: number): MemoryVersionText {
    const conn = this.d.connectionId()
    if (conn === undefined) return { ok: false, error: 'not-connected' }
    const row = this.d.store.getSnapshot(conn, id)
    return row ? { ok: true, id: row.id, text: row.content } : { ok: false, error: 'not-found' }
  }

  clear(): number {
    const conn = this.d.connectionId()
    return conn === undefined ? 0 : this.d.store.clearSnapshots(conn)
  }
}
