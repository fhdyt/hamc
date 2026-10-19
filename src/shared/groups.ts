/*
 * Group chat rooms (v2, F-ROOM-1..8): the user and 2 to 6 agents in one conversation. The rules follow the
 * client-owned room path of Hermes Desktop (apps/desktop/src/plugins/hermes-bots/group-rounds.ts, Hermes v2026.8.31):
 * one Send starts at most three serial rounds, the members mentioned since the last user message speak (everyone when
 * nobody is mentioned), "(pass)" is silence, and each member is shown only the room lines that are new to it. Pure, so
 * the main process (rounds) and the renderer (mention suggestions) share it.
 */

import type { ChatEvent } from './ipc'

export const GROUP_ID_RE = /^mc-[a-z0-9]{10}$/
export const GROUP_MIN_MEMBERS = 2
export const GROUP_MAX_MEMBERS = 6
export const GROUP_NAME_MAX = 60
/** Rounds one Send may start, and member messages it may produce (Hermes Desktop's caps). */
export const MAX_ROUNDS = 3
export const MAX_MESSAGES = 10
/** The most room lines one member prompt carries, and where one line is cut. */
export const HISTORY_LINES = 24
export const LINE_CHARS = 2000
/** A stored reply is cut here. */
export const ENTRY_CHARS = 16_000
export const ENTRIES_PER_GROUP = 2000
/** The longest message the user may send to a room (as in the 1:1 chat). */
export const GROUP_MESSAGE_MAX = 100_000

export type GroupEntryStatus = 'ok' | 'pass' | 'failed' | 'stopped'

/** One line of the room log. `author` is `user` or a member's profile. */
export interface GroupEntry {
  seq: number
  author: string
  text: string
  status: GroupEntryStatus
  ts: number
}

export interface GroupRoom {
  id: string
  name: string
  /** Profiles, in the order the user picked them. */
  members: string[]
  /** A member asked the user (`@user`) in the last run. */
  needsYou: boolean
  createdAt: number
  updatedAt: number
  last: { ts: number; author: string; text: string } | null
}

export type GroupRunEnd = 'settled' | 'cap' | 'stopped' | 'error'

/** What the main process reports about a room while it runs, on `mc:ev:group`. */
export type GroupEvent = { groupId: string } & (
  | { kind: 'run-start' }
  | { kind: 'turn-start'; profile: string; turn: string }
  /** One event of the member turn that runs now, in the 1:1 chat's shape (text, tools, approvals, errors, end). */
  | { kind: 'turn'; event: ChatEvent }
  | { kind: 'entry'; entry: GroupEntry }
  | { kind: 'turn-end'; profile: string; turn: string }
  | { kind: 'run-end'; reason: GroupRunEnd; replies: number; needsYou: string | null; error?: string }
  /** The room list changed (created, renamed, members, deleted). */
  | { kind: 'changed' }
)

export type GroupSendError = 'not-connected' | 'busy' | 'empty' | 'too-long' | 'not-found' | 'no-gateway'
export type GroupSendResult = { ok: true } | { ok: false; error: GroupSendError; detail?: string }

export interface GroupList {
  rooms: GroupRoom[]
  /** Rooms with a run going. */
  running: string[]
  /** Rooms need Hermes's TUI gateway; `reason` says why it cannot be used. */
  gateway: { ok: boolean; reason?: string }
}

export interface GroupMember {
  profile: string
  /** The name the user sees (local display name, else Hermes's). */
  name: string
}

export function newGroupId(rand: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = 'mc-'
  for (let i = 0; i < 10; i++) s += abc[Math.floor(rand() * abc.length) % abc.length]
  return s
}

/** A room name as stored: trimmed, inner whitespace collapsed; null when empty, too long or with control characters. */
export function cleanGroupName(raw: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  const s = raw.replace(/\s+/g, ' ').trim()
  return s && s.length <= GROUP_NAME_MAX ? s : null
}

/** The title of a member's Hermes session for a room, as Hermes Desktop names it (by the immutable room id). */
export const groupTitle = (id: string): string => `Group: ${id}`

export function groupIdOfTitle(title: string): string | null {
  const m = /^Group: (mc-[a-z0-9]{10})$/.exec(title.trim())
  return m ? m[1]! : null
}

const slug = (s: string): string => s.toLowerCase().trim().replace(/[\s_]+/g, '-')
const collapsed = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, '')

/** The names a member answers to after `@`, lower case. */
export function mentionForms(m: GroupMember): string[] {
  const forms = new Set<string>([m.profile.toLowerCase()])
  const name = m.name.trim()
  if (name) {
    forms.add(slug(name))
    forms.add(collapsed(name))
    forms.add(name.split(/\s+/)[0]!.toLowerCase())
  }
  forms.delete('')
  return [...forms]
}

const MENTION = /(^|[^\w@.])@(?:"([^"]{1,60})"|([\w.-]{1,64}))/g

/** The members, `@everyone`/`@all` and `@user` a text mentions; case does not matter. */
export function parseMentions(text: string, members: GroupMember[]): { mentioned: string[]; everyone: boolean; user: boolean } {
  const mentioned: string[] = []
  let everyone = false
  let user = false
  for (const m of text.matchAll(MENTION)) {
    const raw = (m[2] ?? m[3] ?? '').replace(/[.-]+$/, '')
    const word = raw.toLowerCase()
    if (word === 'everyone' || word === 'all') everyone = true
    else if (word === 'user') user = true
    else {
      const forms = [word, slug(raw), collapsed(raw)]
      const hit = members.find((mem) => mentionForms(mem).some((f) => forms.includes(f)))
      if (hit && !mentioned.includes(hit.profile)) mentioned.push(hit.profile)
    }
  }
  return { mentioned, everyone, user }
}

/** Who speaks this round: the members mentioned since the last user message, or everyone. */
export function responders(log: GroupEntry[], members: GroupMember[]): GroupMember[] {
  let from = 0
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i]!.author === 'user') {
      from = i
      break
    }
  }
  const named = new Set<string>()
  let everyone = false
  for (const entry of log.slice(from)) {
    if (entry.status !== 'ok') continue
    const p = parseMentions(entry.text, members)
    if (p.everyone) everyone = true
    for (const n of p.mentioned) named.add(n)
  }
  if (everyone || named.size === 0) return members
  return members.filter((m) => named.has(m.profile))
}

/** A different member leads each round. */
export function rotate<T>(list: T[], round: number): T[] {
  if (list.length < 2) return list
  const k = round % list.length
  return [...list.slice(k), ...list.slice(0, k)]
}

/** One room line as `viewer` sees it in its prompt: `Name (user): …`, `Name: …`, `Name (you): …`. */
export function formatLine(e: GroupEntry, viewer: string, names: Record<string, string>): string {
  const text = e.text.length > LINE_CHARS ? `${e.text.slice(0, LINE_CHARS - 1)}…` : e.text
  if (e.author === 'user') return `${names['user'] ?? 'User'} (user): ${text}`
  const who = names[e.author] ?? e.author
  return `${who}${e.author === viewer ? ' (you)' : ''}: ${text}`
}

/** The whole turn payload for one member: who is in the room, the new lines, and the room rules (as Hermes Desktop). */
export function turnPrompt(i: { roomName: string; members: GroupMember[]; viewer: GroupMember; lines: string[] }): string {
  const peers = i.members.filter((m) => m.profile !== i.viewer.profile).map((m) => (m.name && m.name !== m.profile ? `${m.name} (@${m.profile})` : `${m.profile} (@${m.profile})`))
  return [
    `[Group chat: "${i.roomName}"] You are @${i.viewer.profile}, one participant in a group chat with ${peers.join(', ') || 'no one else yet'} and the user.`,
    '',
    'New messages in the room since your last turn (oldest first):',
    ...i.lines.map((l) => `  ${l}`),
    '',
    'Rules for this room:',
    '- Reply with ONE conversational message ONLY if you have something new worth adding: build on what was just said, claim or hand off work, answer a question aimed at you, or report a real result. Keep chatter short (1-3 sentences), but when you are delivering a result, an answer the user asked for, or substantive work, give it at full quality and length; never thin out real content to fit the room.',
    '- If you have nothing new to add, reply with exactly "(pass)". Passing is good: it lets the conversation settle.',
    '- Mention a teammate as @name to pull them in; mention @user only for a judgment call or a result the user needs. Do not repeat points already made.',
    '- Never reveal content from your private 1:1 chats. Your reply text goes to the room verbatim: no preamble, no meta-commentary.'
  ].join('\n')
}

/** Silence: nothing, or "(pass)" with any brackets, dots and case. */
export function isPass(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[()[\].!*_`"']/g, '').trim()
  return t === '' || t === 'pass'
}

export function cutEntry(text: string): string {
  return text.length > ENTRY_CHARS ? `${text.slice(0, ENTRY_CHARS - 1)}…` : text
}
