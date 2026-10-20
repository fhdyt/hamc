import type { SavedConnection } from '@shared/ipc'

/** F-CONN-14: what the app calls a saved server: its label, else user@host. */
export function serverName(s: Pick<SavedConnection, 'label' | 'username' | 'host'>): string {
  return s.label || `${s.username}@${s.host}`
}

export function serverAddress(s: Pick<SavedConnection, 'username' | 'host' | 'port'>): string {
  return `${s.username}@${s.host}:${s.port}`
}

export interface BusyInput {
  /** Chat turns sending or streaming. */
  chats: number
  /** Room runs in progress. */
  rooms: number
  /** Uploads not finished. */
  uploads: number
  /** Unsaved drafts in Settings → Agents. */
  drafts: number
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** What switching to another server would stop, one short line each; empty when nothing would. */
export function busyWork(b: BusyInput): string[] {
  const out: string[] = []
  if (b.chats > 0) out.push(`${plural(b.chats, 'chat reply', 'chat replies')} in progress`)
  if (b.rooms > 0) out.push(`${plural(b.rooms, 'room conversation', 'room conversations')} running`)
  if (b.uploads > 0) out.push(`${plural(b.uploads, 'upload', 'uploads')} in progress`)
  if (b.drafts > 0) out.push('unsaved changes in Settings → Agents')
  return out
}
