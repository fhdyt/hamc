import { create } from 'zustand'

interface UnreadState {
  /** Finished replies the user has not seen, per agent. */
  counts: Record<string, number>
  add(profile: string): void
  clear(profile: string): void
  reset(): void
}

export const totalUnread = (counts: Record<string, number>): number => Object.values(counts).reduce((s, n) => s + n, 0)

export const useUnread = create<UnreadState>()((set) => ({
  counts: {},
  add: (profile) => set((s) => ({ counts: { ...s.counts, [profile]: (s.counts[profile] ?? 0) + 1 } })),
  clear: (profile) =>
    set((s) => {
      if (!(profile in s.counts)) return s
      const { [profile]: _gone, ...rest } = s.counts
      return { counts: rest }
    }),
  reset: () => set({ counts: {} })
}))
