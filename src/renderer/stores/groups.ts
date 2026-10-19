import { create } from 'zustand'
import type { GroupEntry, GroupEvent, GroupList, GroupRoom, GroupRunEnd } from '@shared/groups'
import { foldEvent, newTurn, type Turn } from '../lib/chat'

/** The member turn of a room that runs now. */
export interface LiveTurn {
  profile: string
  turn: Turn
}

export interface RunEnd {
  reason: GroupRunEnd
  replies: number
  error?: string
}

interface GroupsState {
  rooms: GroupRoom[]
  loaded: boolean
  running: Record<string, boolean>
  gateway: { ok: boolean; reason?: string }
  /** The room open in the Chat screen; null shows the agent chat. */
  current: string | null
  entries: Record<string, GroupEntry[]>
  entriesState: Record<string, 'loading' | 'ok' | 'error'>
  live: Record<string, LiveTurn | null>
  ended: Record<string, RunEnd | undefined>
  drafts: Record<string, string>
  sending: Record<string, boolean>
  sendError: Record<string, string | null>
  setList(l: GroupList): void
  setCurrent(id: string | null): void
  setEntries(id: string, entries: GroupEntry[] | null): void
  setEntriesState(id: string, s: 'loading' | 'ok' | 'error'): void
  setDraft(id: string, text: string): void
  setSending(id: string, on: boolean, error?: string | null): void
  apply(ev: GroupEvent, now?: number): void
  reset(): void
}

const init = {
  rooms: [] as GroupRoom[],
  loaded: false,
  running: {} as Record<string, boolean>,
  gateway: { ok: true } as { ok: boolean; reason?: string },
  current: null as string | null,
  entries: {} as Record<string, GroupEntry[]>,
  entriesState: {} as Record<string, 'loading' | 'ok' | 'error'>,
  live: {} as Record<string, LiveTurn | null>,
  ended: {} as Record<string, RunEnd | undefined>,
  drafts: {} as Record<string, string>,
  sending: {} as Record<string, boolean>,
  sendError: {} as Record<string, string | null>
}

/** Adds an entry the main process reported, once, in seq order. */
export function addEntry(list: GroupEntry[] | undefined, e: GroupEntry): GroupEntry[] {
  const cur = list ?? []
  if (cur.some((x) => x.seq === e.seq)) return cur
  const next = [...cur, e]
  return next[next.length - 2] && next[next.length - 2]!.seq > e.seq ? next.sort((a, b) => a.seq - b.seq) : next
}

export const useGroups = create<GroupsState>()((set) => ({
  ...init,
  setList: (l) =>
    set((s) => ({
      rooms: l.rooms,
      loaded: true,
      gateway: l.gateway,
      running: Object.fromEntries(l.running.map((id) => [id, true])),
      current: s.current !== null && !l.rooms.some((r) => r.id === s.current) ? null : s.current
    })),
  setCurrent: (current) => set({ current }),
  setEntries: (id, entries) =>
    set((s) => {
      if (entries === null) {
        const { [id]: _e, ...rest } = s.entries
        return { entries: rest }
      }
      return { entries: { ...s.entries, [id]: entries }, entriesState: { ...s.entriesState, [id]: 'ok' } }
    }),
  setEntriesState: (id, st) => set((s) => ({ entriesState: { ...s.entriesState, [id]: st } })),
  setDraft: (id, text) => set((s) => ({ drafts: { ...s.drafts, [id]: text } })),
  setSending: (id, on, error) => set((s) => ({ sending: { ...s.sending, [id]: on }, ...(error !== undefined ? { sendError: { ...s.sendError, [id]: error } } : {}) })),
  apply: (ev, now = Date.now()) =>
    set((s) => {
      const id = ev.groupId
      switch (ev.kind) {
        case 'run-start':
          return { running: { ...s.running, [id]: true }, ended: { ...s.ended, [id]: undefined }, rooms: s.rooms.map((r) => (r.id === id ? { ...r, needsYou: false } : r)) }
        case 'turn-start':
          return { live: { ...s.live, [id]: { profile: ev.profile, turn: newTurn(ev.turn, 'gateway', now) } } }
        case 'turn': {
          const cur = s.live[id]
          if (!cur || cur.turn.id !== ev.event.turn) return s
          const turn = foldEvent(cur.turn, ev.event, now)
          return turn ? { live: { ...s.live, [id]: { ...cur, turn } } } : s
        }
        case 'entry':
          // a room whose log was never opened is loaded in full when it is opened
          return s.entries[id] ? { entries: { ...s.entries, [id]: addEntry(s.entries[id], ev.entry) } } : s
        case 'turn-end':
          return s.live[id]?.turn.id === ev.turn ? { live: { ...s.live, [id]: null } } : s
        case 'run-end': {
          const { [id]: _r, ...running } = s.running
          return {
            running,
            live: { ...s.live, [id]: null },
            ended: { ...s.ended, [id]: { reason: ev.reason, replies: ev.replies, ...(ev.error ? { error: ev.error } : {}) } },
            rooms: s.rooms.map((r) => (r.id === id && ev.needsYou ? { ...r, needsYou: true } : r))
          }
        }
        default:
          return s
      }
    }),
  reset: () => set({ ...init })
}))
