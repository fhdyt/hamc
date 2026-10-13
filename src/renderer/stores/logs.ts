import { create } from 'zustand'
import type { LogFileInfo, LogsRead } from '@shared/events'
import type { LogFileName } from '@shared/logs'

export type LogsTab = 'logs' | 'gateway' | 'approvals'

export type ApprovalsEntry =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; policy: string; policyError: string | null; suggest: string; suggestError: string | null }

/** The newest lines kept in memory; older ones are dropped while following. */
export const LOG_KEEP = 5000

interface LogsState {
  tab: LogsTab
  /** The agent whose logs are open. */
  profile: string | null
  files: LogFileInfo[]
  file: LogFileName | null
  /** A file to open first (the palette action for errors). */
  pendingFile: LogFileName | null
  lines: string[]
  /** Where the next Follow read continues. */
  offset: number
  mtime: number | null
  more: boolean
  /** How many lines the last full read asked for. */
  limit: number
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
  following: boolean
  /** The reader scrolled away from the newest line. */
  paused: boolean
  newLines: number
  notice: string | null
  component: string
  query: string
  approvals: Record<string, ApprovalsEntry>
  setTab(tab: LogsTab): void
  setComponent(c: string): void
  setQuery(q: string): void
  setFollowing(on: boolean): void
  setPaused(on: boolean): void
  setProfile(profile: string): void
  applyFiles(files: LogFileInfo[]): void
  selectFile(file: LogFileName | null): void
  setStatus(status: 'loading'): void
  applyInitial(data: LogsRead, limit: number): void
  applyFollow(data: LogsRead): void
  setError(message: string): void
  setApprovals(profile: string, entry: ApprovalsEntry): void
  reset(): void
}

const EMPTY = {
  tab: 'logs' as LogsTab,
  profile: null as string | null,
  files: [] as LogFileInfo[],
  file: null as LogFileName | null,
  pendingFile: null as LogFileName | null,
  lines: [] as string[],
  offset: 0,
  mtime: null as number | null,
  more: false,
  limit: 500,
  status: 'idle' as LogsState['status'],
  error: null as string | null,
  following: true,
  paused: false,
  newLines: 0,
  notice: null as string | null,
  component: 'all',
  query: '',
  approvals: {} as Record<string, ApprovalsEntry>
}

export const useLogs = create<LogsState>()((set) => ({
  ...EMPTY,
  setTab: (tab) => set({ tab }),
  setComponent: (component) => set({ component }),
  setQuery: (query) => set({ query }),
  setFollowing: (following) => set({ following }),
  setPaused: (paused) => set((s) => ({ paused, newLines: paused ? s.newLines : 0 })),
  setProfile: (profile) => set((s) => (s.profile === profile ? { status: 'loading' } : { profile, files: [], file: null, lines: [], offset: 0, more: false, status: 'loading', error: null, notice: null, component: 'all', newLines: 0 })),
  applyFiles: (files) => set({ files }),
  selectFile: (file) => set({ file, lines: [], offset: 0, more: false, notice: null, component: 'all', newLines: 0 }),
  setStatus: (status) => set({ status }),
  applyInitial: (data, limit) => set({ lines: data.lines, offset: data.offset, mtime: data.mtime, more: data.more, limit, status: 'ok', error: null, newLines: 0, notice: null }),
  applyFollow: (data) =>
    set((s) => {
      if (data.reset) return { lines: data.lines, offset: data.offset, mtime: data.mtime, more: data.more, status: 'ok', error: null, notice: 'The log was rotated.', newLines: 0 }
      const all = [...s.lines, ...data.lines]
      const cut = all.length > LOG_KEEP
      return {
        lines: cut ? all.slice(all.length - LOG_KEEP) : all,
        offset: data.offset,
        mtime: data.mtime,
        more: s.more || cut,
        status: 'ok',
        error: null,
        notice: data.skipped ? 'Some lines were skipped because they came in too fast.' : s.notice,
        newLines: s.paused ? s.newLines + data.lines.length : 0
      }
    }),
  setError: (error) => set({ status: 'error', error }),
  setApprovals: (profile, entry) => set((s) => ({ approvals: { ...s.approvals, [profile]: entry } })),
  reset: () => set({ ...EMPTY, approvals: {} })
}))
