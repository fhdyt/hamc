import { create } from 'zustand'
import type { FeedItem, SessionRow, SessionsList, SessionTranscript } from '@shared/events'
import { DEFAULT_QUERY, mergeFirstPage, patchRow, rowKey, type SessionQuery } from '../lib/sessions'

export type ListMode = 'replace' | 'append' | 'head'

export interface TranscriptState {
  status: 'idle' | 'loading' | 'ok' | 'error'
  session: SessionRow | null
  items: FeedItem[]
  /** Id of the last message read when more may follow, else null. */
  nextAfter: number | null
  chain: SessionTranscript['chain'] | null
  total: number | null
  error: string | null
  loadingMore: boolean
}

export const EMPTY_TRANSCRIPT: TranscriptState = { status: 'idle', session: null, items: [], nextAfter: null, chain: null, total: null, error: null, loadingMore: false }

export interface Notice {
  kind: 'ok' | 'error'
  text: string
}

interface SessionsState {
  query: SessionQuery
  rows: SessionRow[]
  sources: string[]
  more: boolean
  fallback: 'title' | null
  errors: SessionsList['errors']
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
  receivedAt: number | null
  loadingMore: boolean
  selected: { profile: string; id: string } | null
  transcript: TranscriptState
  notice: Notice | null
  setQuery(patch: Partial<SessionQuery>): void
  applyList(data: SessionsList, mode: ListMode, now?: number): void
  clearList(): void
  setStatus(status: 'loading'): void
  setError(message: string): void
  setLoadingMore(on: boolean): void
  select(sel: { profile: string; id: string } | null): void
  applyTranscript(data: SessionTranscript, append: boolean): void
  setTranscriptError(message: string): void
  setTranscriptLoadingMore(on: boolean): void
  patchRow(key: string, patch: Partial<SessionRow>): void
  setNotice(n: Notice | null): void
  reset(): void
}

const EMPTY = {
  query: DEFAULT_QUERY,
  rows: [] as SessionRow[],
  sources: [] as string[],
  more: false,
  fallback: null as 'title' | null,
  errors: [] as SessionsList['errors'],
  status: 'idle' as SessionsState['status'],
  error: null as string | null,
  receivedAt: null as number | null,
  loadingMore: false,
  selected: null as { profile: string; id: string } | null,
  transcript: EMPTY_TRANSCRIPT,
  notice: null as Notice | null
}

export const useSessions = create<SessionsState>()((set) => ({
  ...EMPTY,
  setQuery: (patch) => set((s) => ({ query: { ...s.query, ...patch } })),
  applyList: (data, mode, now = Date.now()) =>
    set((s) => {
      let rows: SessionRow[]
      if (mode === 'replace') rows = data.rows
      else if (mode === 'append') {
        const seen = new Set(s.rows.map(rowKey))
        rows = [...s.rows, ...data.rows.filter((r) => !seen.has(rowKey(r)))]
      } else rows = mergeFirstPage(s.rows, data.rows)
      const more = mode === 'head' ? data.more || rows.length > data.rows.length : data.more
      return { rows, more, sources: data.sources, fallback: data.fallback, errors: data.errors, status: 'ok', error: null, receivedAt: now, loadingMore: false }
    }),
  clearList: () => set({ rows: [], more: false, fallback: null, errors: [], error: null, receivedAt: null, loadingMore: false }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ status: 'error', error, loadingMore: false }),
  setLoadingMore: (loadingMore) => set({ loadingMore }),
  select: (selected) => set({ selected, transcript: selected ? { ...EMPTY_TRANSCRIPT, status: 'loading' } : EMPTY_TRANSCRIPT }),
  applyTranscript: (data, append) =>
    set((s) => {
      const seen = new Set(append ? s.transcript.items.map((i) => i.id) : [])
      const items = append ? [...s.transcript.items, ...data.items.filter((i) => !seen.has(i.id))] : data.items
      return { transcript: { status: 'ok', session: data.session, items, nextAfter: data.nextAfter, chain: data.chain, total: data.total, error: null, loadingMore: false } }
    }),
  setTranscriptError: (error) => set((s) => ({ transcript: { ...s.transcript, status: s.transcript.items.length > 0 ? 'ok' : 'error', error, loadingMore: false } })),
  setTranscriptLoadingMore: (loadingMore) => set((s) => ({ transcript: { ...s.transcript, loadingMore } })),
  patchRow: (key, patch) =>
    set((s) => ({
      rows: patchRow(s.rows, key, patch),
      transcript: s.transcript.session && rowKey(s.transcript.session) === key ? { ...s.transcript, session: { ...s.transcript.session, ...patch } } : s.transcript
    })),
  setNotice: (notice) => set({ notice }),
  reset: () => set({ ...EMPTY })
}))
