import { create } from 'zustand'
import type { FeedData, FeedItem, FeedKind } from '@shared/events'
import { DEFAULT_FILTER, mergeFeed, toggled, type FeedFilter } from '../lib/feed'

interface FeedState {
  items: FeedItem[]
  receivedAt: number | null
  filter: FeedFilter
  /** Items that arrived while the reader was away from the top. */
  unseen: number
  atTop: boolean
  /** Profiles with nothing older left to load. */
  exhausted: Record<string, boolean>
  loadingOlder: boolean
  olderError: string | null
  modalOpen: boolean
  /** The session shown in the session modal, as profile + id. */
  session: { profile: string; sessionId: string } | null
  applyFeed(data: FeedData, now?: number): void
  mergeOlder(items: FeedItem[], exhausted: Record<string, boolean>): void
  setFilter(patch: Partial<FeedFilter>): void
  toggleAgent(profile: string): void
  toggleKind(kind: FeedKind): void
  toggleSource(source: string): void
  soloAgent(profile: string, all: readonly string[]): void
  resetFilter(): void
  setAtTop(atTop: boolean): void
  setLoadingOlder(loading: boolean, error?: string | null): void
  openModal(): void
  closeModal(): void
  openSession(profile: string, sessionId: string): void
  closeSession(): void
  reset(): void
}

const EMPTY = {
  items: [] as FeedItem[],
  receivedAt: null as number | null,
  filter: DEFAULT_FILTER,
  unseen: 0,
  atTop: true,
  exhausted: {} as Record<string, boolean>,
  loadingOlder: false,
  olderError: null as string | null,
  modalOpen: false,
  session: null as { profile: string; sessionId: string } | null
}

export const useFeed = create<FeedState>()((set) => ({
  ...EMPTY,
  applyFeed: (data, now = Date.now()) =>
    set((s) => {
      const { items, added } = mergeFeed(s.items, data.items)
      return {
        items,
        receivedAt: now,
        unseen: !data.history && !s.atTop ? s.unseen + added : s.unseen
      }
    }),
  mergeOlder: (older, exhausted) =>
    set((s) => ({ items: mergeFeed(s.items, older).items, exhausted: { ...s.exhausted, ...exhausted }, loadingOlder: false, olderError: null })),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  toggleAgent: (profile) => set((s) => ({ filter: { ...s.filter, hiddenAgents: toggled(s.filter.hiddenAgents, profile) } })),
  toggleKind: (kind) => set((s) => ({ filter: { ...s.filter, hiddenKinds: toggled(s.filter.hiddenKinds, kind) } })),
  toggleSource: (source) => set((s) => ({ filter: { ...s.filter, hiddenSources: toggled(s.filter.hiddenSources, source) } })),
  soloAgent: (profile, all) => set((s) => ({ filter: { ...s.filter, hiddenAgents: all.filter((p) => p !== profile) } })),
  resetFilter: () => set({ filter: DEFAULT_FILTER }),
  setAtTop: (atTop) => set((s) => (s.atTop === atTop ? s : { atTop, unseen: atTop ? 0 : s.unseen })),
  setLoadingOlder: (loadingOlder, error = null) => set({ loadingOlder, olderError: error }),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  openSession: (profile, sessionId) => set({ session: { profile, sessionId } }),
  closeSession: () => set({ session: null }),
  reset: () => set({ ...EMPTY })
}))
