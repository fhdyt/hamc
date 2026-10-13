import { create } from 'zustand'
import { NOTICE_HISTORY, type Notice } from '@shared/notify'

interface NoticesState {
  /** Newest first, at most NOTICE_HISTORY. Lives in memory only, like conversation text. */
  list: Notice[]
  /** Ids not seen in the bell yet. */
  unread: string[]
  /** Ids shown as toasts right now. */
  toasts: string[]
  open: boolean
  add(n: Notice, toast: boolean): void
  dismissToast(id: string): void
  setOpen(open: boolean): void
  markAllRead(): void
  clear(): void
}

export const useNotices = create<NoticesState>()((set) => ({
  list: [],
  unread: [],
  toasts: [],
  open: false,
  add: (n, toast) =>
    set((s) => {
      const list = [n, ...s.list.filter((x) => x.id !== n.id)].slice(0, NOTICE_HISTORY)
      const keep = new Set(list.map((x) => x.id))
      return {
        list,
        unread: s.open ? s.unread : [n.id, ...s.unread].filter((id) => keep.has(id)),
        toasts: toast ? [n.id, ...s.toasts].slice(0, 3) : s.toasts
      }
    }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x !== id) })),
  setOpen: (open) => set((s) => ({ open, unread: open ? [] : s.unread })),
  markAllRead: () => set({ unread: [] }),
  clear: () => set({ list: [], unread: [], toasts: [] })
}))
