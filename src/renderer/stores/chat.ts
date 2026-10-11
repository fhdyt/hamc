import { create } from 'zustand'
import type { FeedItem } from '@shared/events'
import type { Attachment, ChatEvent, UploadProgress } from '@shared/ipc'
import { foldEvent, type PendingUser, type Turn } from '../lib/chat'

/** A file waiting to be sent with the next message, with how its upload is going. */
export interface AttFile extends Attachment {
  state: 'ready' | 'uploading' | 'done' | 'error' | 'cancelled'
  sent: number
  error?: string
}

export interface ChatRoom {
  sessionId: string | null
  /** The saved session id was read from the main process. */
  loaded: boolean
  history: FeedItem[]
  historyState: 'idle' | 'loading' | 'ok' | 'error'
  historyError: string | null
  pending: PendingUser | null
  turn: Turn | null
  draft: string
  files: AttFile[]
  /** From pressing Send until the turn has started (uploads included). */
  sending: boolean
  sendError: string | null
  /** A warning about the agent's terminal backend, shown when files are attached. */
  backendWarning: string | null
}

export const emptyRoom = (): ChatRoom => ({
  sessionId: null,
  loaded: false,
  history: [],
  historyState: 'idle',
  historyError: null,
  pending: null,
  turn: null,
  draft: '',
  files: [],
  sending: false,
  sendError: null,
  backendWarning: null
})

interface ChatState {
  rooms: Record<string, ChatRoom>
  /** The agent open in the Chat screen. */
  current: string | null
  patch(profile: string, fn: (r: ChatRoom) => Partial<ChatRoom>): void
  setCurrent(profile: string | null): void
  applyChat(ev: ChatEvent, now?: number): void
  applyUpload(p: UploadProgress): void
  reset(): void
}

export const useChat = create<ChatState>()((set) => ({
  rooms: {},
  current: null,
  patch: (profile, fn) =>
    set((s) => {
      const cur = s.rooms[profile] ?? emptyRoom()
      return { rooms: { ...s.rooms, [profile]: { ...cur, ...fn(cur) } } }
    }),
  setCurrent: (current) => set({ current }),
  applyChat: (ev, now = Date.now()) =>
    set((s) => {
      const cur = s.rooms[ev.profile] ?? emptyRoom()
      const turn = foldEvent(cur.turn, ev, now)
      const next: ChatRoom = { ...cur, turn }
      if (ev.kind === 'start') {
        next.sending = false
        next.sendError = null
      }
      if (ev.kind === 'session') {
        next.sessionId = ev.sessionId
        next.loaded = true
        if (next.historyState === 'idle') next.historyState = 'ok'
      }
      return { rooms: { ...s.rooms, [ev.profile]: next } }
    }),
  applyUpload: (p) =>
    set((s) => {
      let changed = false
      const rooms: Record<string, ChatRoom> = {}
      for (const [profile, room] of Object.entries(s.rooms)) {
        const i = room.files.findIndex((f) => f.id === p.id)
        if (i < 0) {
          rooms[profile] = room
          continue
        }
        changed = true
        const files = room.files.map((f, k) => (k === i ? { ...f, state: p.state, sent: p.sent, ...(p.error ? { error: p.error } : {}) } : f))
        rooms[profile] = { ...room, files }
      }
      return changed ? { rooms } : s
    }),
  reset: () => set({ rooms: {}, current: null })
}))

/** True when this agent has a turn that has not ended, or a Send in progress. */
export const isBusy = (r: ChatRoom | undefined): boolean => !!r && (r.sending || (r.turn !== null && !r.turn.ended))
