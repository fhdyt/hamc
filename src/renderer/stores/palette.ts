import { create } from 'zustand'
import type { SessionRow } from '@shared/events'

interface PaletteState {
  open: boolean
  query: string
  /** The highlighted row. */
  index: number
  /** The newest sessions, loaded when the palette opens. */
  sessions: SessionRow[]
  loadedAt: number | null
  loading: boolean
  error: string | null
  setOpen(open: boolean): void
  setQuery(q: string): void
  setIndex(i: number): void
  applySessions(rows: SessionRow[], now?: number): void
  setLoading(on: boolean): void
  setError(message: string | null): void
  reset(): void
}

const EMPTY = { open: false, query: '', index: 0, sessions: [] as SessionRow[], loadedAt: null as number | null, loading: false, error: null as string | null }

export const usePalette = create<PaletteState>()((set) => ({
  ...EMPTY,
  setOpen: (open) => set(open ? { open, query: '', index: 0 } : { open }),
  setQuery: (query) => set({ query, index: 0 }),
  setIndex: (index) => set({ index }),
  applySessions: (sessions, now = Date.now()) => set({ sessions, loadedAt: now, loading: false, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set({ ...EMPTY })
}))
