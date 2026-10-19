import { mentionForms, type GroupEntry, type GroupMember, type GroupRoom, type GroupRunEnd } from '@shared/groups'
import type { Turn } from './chat'

/** What a room's conversation shows, oldest first. */
export type GroupConv =
  | { kind: 'user'; id: string; ts: number; text: string }
  | { kind: 'member'; id: string; ts: number; profile: string; text: string }
  /** Members that passed one after another, folded into one quiet line. */
  | { kind: 'quiet'; id: string; profiles: string[] }
  | { kind: 'failed'; id: string; ts: number; profile: string; text: string }
  | { kind: 'stopped'; id: string; ts: number; profile: string; text: string }
  | { kind: 'live'; id: string; profile: string; turn: Turn }
  | { kind: 'end'; id: string; reason: GroupRunEnd; text: string }

export const END_TEXT: Record<GroupRunEnd, string> = {
  settled: 'The room settled: nobody has more to add.',
  cap: 'The room reached its limit for one message (3 rounds or 10 replies). Send another message to go on.',
  stopped: 'Stopped.',
  error: 'The room stopped because of an error.'
}

export function buildGroupConv(entries: readonly GroupEntry[], live: { profile: string; turn: Turn } | null, ended: { reason: GroupRunEnd; error?: string } | undefined, running: boolean): GroupConv[] {
  const out: GroupConv[] = []
  for (const e of entries) {
    const id = `e${e.seq}`
    if (e.author === 'user') out.push({ kind: 'user', id, ts: e.ts, text: e.text })
    else if (e.status === 'ok') out.push({ kind: 'member', id, ts: e.ts, profile: e.author, text: e.text })
    else if (e.status === 'pass') {
      const last = out[out.length - 1]
      if (last?.kind === 'quiet') {
        if (!last.profiles.includes(e.author)) last.profiles.push(e.author)
      } else out.push({ kind: 'quiet', id, profiles: [e.author] })
    } else if (e.status === 'failed') out.push({ kind: 'failed', id, ts: e.ts, profile: e.author, text: e.text })
    else out.push({ kind: 'stopped', id, ts: e.ts, profile: e.author, text: e.text })
  }
  if (live) out.push({ kind: 'live', id: `live-${live.turn.id}`, profile: live.profile, turn: live.turn })
  if (ended && !running) out.push({ kind: 'end', id: 'end', reason: ended.reason, text: ended.error ? `${END_TEXT[ended.reason]} ${ended.error}` : END_TEXT[ended.reason] })
  return out
}

/** "Ada passed", "Ada and Bo passed", "Ada, Bo and Cy passed". */
export function quietText(names: string[]): string {
  if (names.length <= 1) return `${names[0] ?? 'Nobody'} passed`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} passed`
}

/** The `@word` being typed at the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([\w.-]{0,64})$/.exec(before)
  if (!m) return null
  return { start: caret - m[2]!.length - 1, query: m[2]! }
}

/** Members whose names start with what was typed after `@` (and `everyone`). */
export function suggest(query: string, members: GroupMember[]): { handle: string; label: string }[] {
  const q = query.toLowerCase()
  const hits = members.filter((m) => q === '' || mentionForms(m).some((f) => f.startsWith(q))).map((m) => ({ handle: m.profile, label: m.name && m.name !== m.profile ? `${m.name} (@${m.profile})` : `@${m.profile}` }))
  if ('everyone'.startsWith(q)) hits.push({ handle: 'everyone', label: '@everyone (all agents)' })
  return hits.slice(0, 8)
}

/** Puts `@handle ` where the typed mention starts. */
export function insertMention(text: string, at: { start: number; query: string }, handle: string): { text: string; caret: number } {
  const end = at.start + 1 + at.query.length
  const add = `@${handle} `
  return { text: text.slice(0, at.start) + add + text.slice(end), caret: at.start + add.length }
}

/** The second line of a room row in the list. */
export function roomSub(room: GroupRoom, running: boolean, unread: number): string {
  if (running) return 'working…'
  if (room.needsYou) return 'needs you'
  if (unread > 0) return unread === 1 ? '1 new reply' : `${unread} new replies`
  return `${room.members.length} agents`
}
