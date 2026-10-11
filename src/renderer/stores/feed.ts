import { create } from 'zustand'
import type { FeedData, FeedItem, FeedKind } from '@shared/events'
import { DEFAULT_FILTER, FEED_CAP, mergeFeed, toggled, type FeedFilter } from '../lib/feed'

export type FullState = { status: 'loading' } | { status: 'ok'; text: string } | { status: 'error'; message: string }

interface FeedState {
  items: FeedItem[]
  receivedAt: number | null
  /** Why the feed cannot be read (a state.db that is missing or unreadable), shown instead of a spinner. */
  error: string | null
  filter: FeedFilter
  /** Items that arrived while the reader was away from the top. */
  unseen: number
  atTop: boolean
  /** Profiles with nothing older left to load. */
  exhausted: Record<string, boolean>
  loadingOlder: boolean
  olderError: string | null
  /** Items the reader expanded (thinking blocks, long texts). Kept here because virtual rows lose local state. */
  expanded: Record<string, true>
  full: Record<string, FullState>
  modalOpen: boolean
  /** The session shown in the session modal, as profile + id. */
  session: { profile: string; sessionId: string } | null
  applyFeed(data: FeedData, now?: number): void
  setError(message: string): void
  mergeOlder(items: FeedItem[], exhausted: Record<string, boolean>): void
  setFilter(patch: Partial<FeedFilter>): void
  toggleAgent(profile: string): void
  toggleKind(kind: FeedKind): void
  toggleSource(source: string): void
  soloAgent(profile: string, all: readonly string[]): void
  resetFilter(): void
  setAtTop(atTop: boolean): void
  setLoadingOlder(loading: boolean, error?: string | null): void
  toggleExpanded(id: string): void
  setFull(id: string, state: FullState): void
  openModal(): void
  closeModal(): void
  openSession(profile: string, sessionId: string): void
  closeSession(): void
  reset(): void
}

const EMPTY = {
  items: [] as FeedItem[],
  receivedAt: null as number | null,
  error: null as string | null,
  filter: DEFAULT_FILTER,
  unseen: 0,
  atTop: true,
  exhausted: {} as Record<string, boolean>,
  loadingOlder: false,
  olderError: null as string | null,
  expanded: {} as Record<string, true>,
  full: {} as Record<string, FullState>,
  modalOpen: false,
  session: null as { profile: string; sessionId: string } | null
}

export const useFeed = create<FeedState>()((set) => ({
  ...EMPTY,
  applyFeed: (data, now = Date.now()) =>
    set((s) => {
      const { items, added } = mergeFeed(s.items, data.items, FEED_CAP * 4)
      return {
        items,
        receivedAt: now,
        error: null,
        unseen: !data.history && !s.atTop ? s.unseen + added : s.unseen
      }
    }),
  setError: (error) => set((s) => (s.receivedAt === null ? { error } : s)),
  mergeOlder: (older, exhausted) =>
    set((s) => ({ items: mergeFeed(s.items, older, Infinity).items, exhausted: { ...s.exhausted, ...exhausted }, loadingOlder: false, olderError: null })),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  toggleAgent: (profile) => set((s) => ({ filter: { ...s.filter, hiddenAgents: toggled(s.filter.hiddenAgents, profile) } })),
  toggleKind: (kind) => set((s) => ({ filter: { ...s.filter, hiddenKinds: toggled(s.filter.hiddenKinds, kind) } })),
  toggleSource: (source) => set((s) => ({ filter: { ...s.filter, hiddenSources: toggled(s.filter.hiddenSources, source) } })),
  soloAgent: (profile, all) => set((s) => ({ filter: { ...s.filter, hiddenAgents: all.filter((p) => p !== profile) } })),
  resetFilter: () => set({ filter: DEFAULT_FILTER }),
  setAtTop: (atTop) => set((s) => (s.atTop === atTop ? s : { atTop, unseen: atTop ? 0 : s.unseen })),
  setLoadingOlder: (loadingOlder, error = null) => set({ loadingOlder, olderError: error }),
  toggleExpanded: (id) =>
    set((s) => {
      const expanded = { ...s.expanded }
      if (expanded[id]) delete expanded[id]
      else expanded[id] = true
      return { expanded }
    }),
  setFull: (id, state) => set((s) => ({ full: { ...s.full, [id]: state } })),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  openSession: (profile, sessionId) => set({ session: { profile, sessionId } }),
  closeSession: () => set({ session: null }),
  reset: () => set({ ...EMPTY })
}))
