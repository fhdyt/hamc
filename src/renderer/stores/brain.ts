import { create } from 'zustand'
import type { BrainData, BrainNote, ObsidianGraph } from '@shared/events'

export type BrainPhase = 'unset' | 'loading' | 'live' | 'error'

export type ObsidianState =
  | { state: 'idle' | 'loading' | 'none' }
  | { state: 'ok'; graph: ObsidianGraph; mtime: number }
  | { state: 'error'; error: string }

interface BrainState {
  /** Whether the saved vault path was already read from the main process. */
  loaded: boolean
  vault: string | null
  phase: BrainPhase
  notes: Map<string, BrainNote>
  /** Incremented whenever `notes` changes, so effects can depend on one number. */
  version: number
  total: number
  truncated: boolean
  error: string | null
  /** Notes that just appeared or changed; `seq` makes a repeated set of ids count as news. */
  pulse: { ids: string[]; seq: number }
  selected: string | null
  hovered: string | null
  local: { id: string; depth: number } | null
  search: string
  noteModal: string | null
  /** F-BRAIN-10: the vault's `.obsidian/graph.json`, read on demand. */
  obsidian: ObsidianState
  setObsidian(o: ObsidianState): void
  setVault(vault: string | null): void
  applyBrain(data: BrainData): void
  setError(message: string): void
  select(id: string | null): void
  setHover(id: string | null): void
  setLocal(local: { id: string; depth: number } | null): void
  setSearch(q: string): void
  openNote(id: string | null): void
  reset(): void
}

const EMPTY = {
  loaded: false,
  vault: null as string | null,
  phase: 'unset' as BrainPhase,
  notes: new Map<string, BrainNote>(),
  version: 0,
  total: 0,
  truncated: false,
  error: null as string | null,
  pulse: { ids: [] as string[], seq: 0 },
  selected: null as string | null,
  hovered: null as string | null,
  local: null as { id: string; depth: number } | null,
  search: '',
  noteModal: null as string | null,
  obsidian: { state: 'idle' } as ObsidianState
}

export const useBrain = create<BrainState>()((set) => ({
  ...EMPTY,
  setVault: (vault) =>
    set((s) => {
      // The first value after connecting must not wipe a snapshot that arrived before the vault path was read.
      const switched = vault === null || (s.vault !== null && vault !== s.vault)
      return {
        loaded: true,
        vault,
        phase: vault === null ? 'unset' : switched || s.notes.size === 0 ? 'loading' : s.phase,
        ...(switched ? { notes: new Map<string, BrainNote>(), version: s.version + 1, total: 0, truncated: false, error: null, selected: null, hovered: null, local: null, noteModal: null } : {})
      }
    }),
  applyBrain: (data) =>
    set((s) => {
      const notes = data.mode === 'snapshot' && data.first ? new Map<string, BrainNote>() : new Map(s.notes)
      for (const id of data.removed) notes.delete(id)
      for (const n of data.notes) notes.set(n.id, n)
      const done = data.mode === 'delta' || data.done
      const pulseIds = data.mode === 'delta' ? data.notes.map((n) => n.id) : []
      return {
        notes,
        version: s.version + 1,
        total: data.total,
        truncated: data.truncated,
        error: null,
        phase: done ? 'live' : 'loading',
        pulse: pulseIds.length > 0 ? { ids: pulseIds, seq: s.pulse.seq + 1 } : s.pulse,
        // a missing note, tag or attachment node is not a note, so it stays selected while the notes change
        selected: s.selected && (!s.selected.endsWith('.md') || notes.has(s.selected)) ? s.selected : null,
        local: s.local && notes.has(s.local.id) ? s.local : null,
        noteModal: s.noteModal && notes.has(s.noteModal) ? s.noteModal : null
      }
    }),
  setError: (error) => set((s) => (s.vault === null ? s : { error, phase: 'error' })),
  select: (selected) => set({ selected }),
  setHover: (hovered) => set((s) => (s.hovered === hovered ? s : { hovered })),
  setLocal: (local) => set({ local }),
  setSearch: (search) => set({ search }),
  openNote: (noteModal) => set({ noteModal }),
  setObsidian: (obsidian) => set({ obsidian }),
  reset: () => set({ ...EMPTY, notes: new Map() })
}))
