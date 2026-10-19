import { randomUUID } from 'node:crypto'
import {
  GROUP_MAX_MEMBERS,
  GROUP_MESSAGE_MAX,
  GROUP_MIN_MEMBERS,
  HISTORY_LINES,
  MAX_MESSAGES,
  MAX_ROUNDS,
  cleanGroupName,
  cutEntry,
  formatLine,
  groupTitle,
  isPass,
  newGroupId,
  parseMentions,
  responders,
  rotate,
  turnPrompt,
  type GroupEntry,
  type GroupEntryStatus,
  type GroupEvent,
  type GroupList,
  type GroupMember,
  type GroupRoom,
  type GroupRunEnd,
  type GroupSendResult
} from '@shared/groups'
import type { ChatEvent } from '@shared/ipc'
import type { GroupStore } from './store'

/*
 * Runs group chat rooms (F-ROOM): one Send of the user starts a run of at most three serial rounds; in each round the
 * members picked by the room rules (shared/groups.ts) answer one after another in their own `Group: <id>` session on
 * the TUI gateway. A member is asked only when the room has lines that are new to it. The run ends when a round stays
 * silent, at ten replies or three rounds, on Stop, or when the connection goes.
 */

export type MemberTurnStart =
  | { ok: true; cancel(): void; approve(approval: string, option: string | null): boolean; done: Promise<void> }
  | { ok: false; error: 'no-gateway' | 'failed-to-start'; detail?: string }

export interface MemberTurnReq {
  groupId: string
  profile: string
  turn: string
  message: string
  /** The member's saved room session, or null for a new one. */
  saved: string | null
  title: string
  emit: (e: ChatEvent) => void
  /** The stored id of the member's room session (new, or rotated by Hermes). */
  onSession: (id: string) => void
}

export interface GroupDeps {
  store: GroupStore
  runTurn(r: MemberTurnReq): Promise<MemberTurnStart>
  available(): { ok: boolean; reason?: string }
  isConnected(): boolean
  /** The profiles on the server, or null before the first agents event. */
  profiles(): string[] | null
  /** Display names by profile. */
  names(): Record<string, string>
  emit(e: GroupEvent): void
  log?(m: string): void
}

interface Run {
  id: string
  stopped: boolean
  current: { turn: string; cancel(): void; approve(approval: string, option: string | null): boolean } | null
}

type TurnOutcome = 'ok' | 'silent' | 'stopped' | 'skipped'

const PROFILE = /^[A-Za-z0-9._-]{1,64}$/

export class GroupService {
  private runs = new Map<string, Run>()

  constructor(private readonly d: GroupDeps) {}

  running(id: string): boolean {
    return this.runs.has(id)
  }

  list(): GroupList {
    return { rooms: this.d.store.list(), running: [...this.runs.keys()], gateway: this.d.available() }
  }

  /** Null when the list is fine. Agents already in the room (`kept`) may have left the server; new ones must exist. */
  private checkMembers(members: string[], kept: readonly string[] = []): string | null {
    const unique = new Set(members)
    if (unique.size !== members.length || members.length < GROUP_MIN_MEMBERS || members.length > GROUP_MAX_MEMBERS || !members.every((m) => PROFILE.test(m))) return `A room has ${GROUP_MIN_MEMBERS} to ${GROUP_MAX_MEMBERS} agents.`
    const known = this.d.profiles()
    const missing = known ? members.find((m) => !known.includes(m) && !kept.includes(m)) : undefined
    return missing ? `${missing} is not an agent on this server.` : null
  }

  create(name: string, members: string[]): GroupRoom | { error: string } {
    const clean = cleanGroupName(name)
    if (!clean) return { error: 'The room needs a name of 1 to 60 characters.' }
    const bad = this.checkMembers(members)
    if (bad) return { error: bad }
    const room = this.d.store.create(newGroupId(), clean, members)
    this.d.log?.(`room ${room.id} created with ${members.length} agents`)
    this.d.emit({ groupId: room.id, kind: 'changed' })
    return room
  }

  update(id: string, patch: { name?: string; members?: string[] }): GroupRoom | { error: string } {
    const room = this.d.store.get(id)
    if (!room) return { error: 'This room does not exist any more.' }
    if (this.runs.has(id) && patch.members) return { error: 'Wait for the room to finish, or stop it, before you change its agents.' }
    const next: { name?: string; members?: string[] } = {}
    if (patch.name !== undefined) {
      const clean = cleanGroupName(patch.name)
      if (!clean) return { error: 'The room needs a name of 1 to 60 characters.' }
      next.name = clean
    }
    if (patch.members !== undefined) {
      const bad = this.checkMembers(patch.members, room.members)
      if (bad) return { error: bad }
      next.members = patch.members
    }
    const out = this.d.store.update(id, next)
    if (!out) return { error: 'This room does not exist any more.' }
    this.d.emit({ groupId: id, kind: 'changed' })
    return out
  }

  remove(id: string): void {
    this.stop(id)
    this.d.store.remove(id)
    this.d.log?.(`room ${id} deleted`)
    this.d.emit({ groupId: id, kind: 'changed' })
  }

  entries(id: string, before?: number): GroupEntry[] {
    return this.d.store.entries(id, before !== undefined ? { before } : {})
  }

  async send(id: string, raw: string): Promise<GroupSendResult> {
    const text = raw.trim()
    if (text === '') return { ok: false, error: 'empty' }
    if (text.length > GROUP_MESSAGE_MAX) return { ok: false, error: 'too-long' }
    const room = this.d.store.get(id)
    if (!room) return { ok: false, error: 'not-found' }
    if (!this.d.isConnected()) return { ok: false, error: 'not-connected' }
    if (this.runs.has(id)) return { ok: false, error: 'busy' }
    const gw = this.d.available()
    if (!gw.ok) return { ok: false, error: 'no-gateway', ...(gw.reason ? { detail: gw.reason } : {}) }
    const run: Run = { id, stopped: false, current: null }
    this.runs.set(id, run)
    this.d.store.setNeedsYou(id, false)
    this.add(id, 'user', text, 'ok')
    this.d.emit({ groupId: id, kind: 'run-start' })
    this.d.log?.(`room ${id} run start`)
    void this.drive(run)
    return { ok: true }
  }

  stop(id: string): void {
    const run = this.runs.get(id)
    if (!run || run.stopped) return
    run.stopped = true
    run.current?.cancel()
  }

  approve(turn: string, approval: string, option: string | null): boolean {
    for (const run of this.runs.values()) if (run.current?.turn === turn) return run.current.approve(approval, option)
    return false
  }

  clear(): void {
    this.d.store.clearEntries()
    for (const r of this.d.store.list()) this.d.emit({ groupId: r.id, kind: 'changed' })
  }

  /** The connection is going away: every run ends as stopped. */
  dispose(): void {
    for (const id of [...this.runs.keys()]) this.stop(id)
  }

  private add(id: string, author: string, text: string, status: GroupEntryStatus): GroupEntry | null {
    // a room deleted while its last turn was ending gets nothing more
    if (!this.d.store.get(id)) return null
    const entry = this.d.store.addEntry(id, author, text, status)
    this.d.emit({ groupId: id, kind: 'entry', entry })
    return entry
  }

  private async drive(run: Run): Promise<void> {
    const id = run.id
    let replies = 0
    let needsYou: string | null = null
    let reason: GroupRunEnd = 'settled'
    let error: string | undefined
    try {
      outer: for (let round = 0; round < MAX_ROUNDS; round++) {
        const room = this.d.store.get(id)
        if (!room || run.stopped) {
          reason = 'stopped'
          break
        }
        const names = this.d.names()
        const members: GroupMember[] = room.members.map((p) => ({ profile: p, name: names[p] ?? p }))
        const speakers = rotate(responders(this.d.store.entries(id), members), round)
        let spoke = false
        for (const m of speakers) {
          if (run.stopped) break
          if (replies >= MAX_MESSAGES) {
            reason = 'cap'
            break outer
          }
          const { outcome, text } = await this.memberTurn(run, room, members, m)
          if (outcome === 'ok') {
            spoke = true
            replies++
            if (parseMentions(text, members).user) needsYou = m.profile
          }
        }
        if (run.stopped) {
          reason = 'stopped'
          break
        }
        if (replies >= MAX_MESSAGES) {
          reason = 'cap'
          break
        }
        if (!spoke) {
          reason = 'settled'
          break
        }
        if (round === MAX_ROUNDS - 1) reason = 'cap'
      }
    } catch (e) {
      reason = 'error'
      error = e instanceof Error ? e.message : String(e)
    } finally {
      this.runs.delete(id)
      if (needsYou && this.d.store.get(id)) this.d.store.setNeedsYou(id, true)
      this.d.log?.(`room ${id} run end ${reason} replies=${replies}`)
      this.d.emit({ groupId: id, kind: 'run-end', reason, replies, needsYou, ...(error ? { error } : {}) })
    }
  }

  /** One member's turn: the prompt with what is new to it, the reply, the entry. */
  private async memberTurn(run: Run, room: GroupRoom, members: GroupMember[], m: GroupMember): Promise<{ outcome: TurnOutcome; text: string }> {
    const id = room.id
    const known = this.d.profiles()
    if (known && !known.includes(m.profile)) {
      this.add(id, m.profile, 'Not on the server any more.', 'failed')
      return { outcome: 'skipped', text: '' }
    }
    const seat = this.d.store.members(id).find((x) => x.profile === m.profile)
    if (!seat) return { outcome: 'skipped', text: '' }
    const fresh = this.d.store.entries(id).filter((e) => e.seq > seat.seenSeq && e.status === 'ok' && e.author !== m.profile)
    if (fresh.length === 0) return { outcome: 'skipped', text: '' }
    const latest = this.d.store.lastSeq(id)
    const names: Record<string, string> = { user: 'User' }
    for (const x of members) names[x.profile] = x.name
    const lines = fresh.slice(-HISTORY_LINES).map((e) => formatLine(e, m.profile, names))
    const message = turnPrompt({ roomName: room.name, members, viewer: m, lines })
    const turn = randomUUID()
    let text = ''
    let err: string | undefined
    let stopped = false
    this.d.emit({ groupId: id, kind: 'turn-start', profile: m.profile, turn })
    const start = await this.d.runTurn({
      groupId: id,
      profile: m.profile,
      turn,
      message,
      saved: seat.sessionId,
      title: groupTitle(id),
      emit: (ev) => {
        if (ev.kind === 'text') text += ev.text
        else if (ev.kind === 'error') err = ev.message
        else if (ev.kind === 'end') stopped = ev.stopped
        this.d.emit({ groupId: id, kind: 'turn', event: ev })
      },
      onSession: (sid) => this.d.store.setSession(id, m.profile, sid)
    })
    if (!start.ok) {
      this.add(id, m.profile, start.detail ?? (start.error === 'no-gateway' ? 'The Hermes TUI gateway is not available.' : 'The turn could not start.'), 'failed')
      this.d.log?.(`room ${id} turn ${m.profile} failed`)
      this.d.emit({ groupId: id, kind: 'turn-end', profile: m.profile, turn })
      return { outcome: 'skipped', text: '' }
    }
    run.current = { turn, cancel: start.cancel, approve: start.approve }
    // a Stop that came while the turn was starting
    if (run.stopped) start.cancel()
    await start.done
    run.current = null
    this.d.store.setSeen(id, m.profile, latest)
    let outcome: TurnOutcome
    if (stopped || run.stopped) {
      this.add(id, m.profile, cutEntry(text), 'stopped')
      outcome = 'stopped'
    } else if (isPass(text) && (err === undefined || /without a reply/.test(err))) {
      this.add(id, m.profile, '(pass)', 'pass')
      outcome = 'silent'
    } else if (text.trim() === '') {
      this.add(id, m.profile, (err ?? 'The turn failed.').slice(0, 500), 'failed')
      outcome = 'silent'
    } else {
      this.add(id, m.profile, cutEntry(text.trim()), 'ok')
      outcome = 'ok'
    }
    this.d.log?.(`room ${id} turn ${m.profile} ${outcome === 'ok' ? 'reply' : outcome === 'silent' ? 'pass' : outcome}`)
    this.d.emit({ groupId: id, kind: 'turn-end', profile: m.profile, turn })
    return { outcome, text }
  }
}
