import { create } from 'zustand'
import type { KanbanBoard, KanbanBoards, KanbanTaskDetail, KanbanTasks } from '@shared/events'
import type { KanbanActionRequest } from '@shared/kanban'

/** A write that waits for Confirm: the request, the question, and the optional text field of block and complete. */
export interface KanbanAsk {
  req: KanbanActionRequest
  question: string
  field?: 'reason' | 'result'
}

export type TaskDetailEntry = { status: 'loading' } | { status: 'error'; message: string } | { status: 'gone' } | { status: 'ok'; data: KanbanTaskDetail }

interface KanbanState {
  /** `idle` until the screen is first opened; `error` keeps whatever was shown before. */
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string | null
  boards: KanbanBoard[]
  boardErrors: KanbanBoards['errors']
  board: string | null
  tasks: KanbanTasks['tasks']
  archived: number
  truncated: boolean
  receivedAt: number | null
  assignee: string
  query: string
  showAllDone: boolean
  notice: string | null
  /** The task whose dialog is open, and the tasks it was opened from (Back). */
  selectedId: string | null
  trail: string[]
  detail: TaskDetailEntry | null
  /** v2 writes: the confirm on screen, a write in flight, the result line, and the New task dialog. */
  ask: KanbanAsk | null
  pending: boolean
  note: { ok: boolean; text: string } | null
  newOpen: boolean
  setStatus(status: 'loading'): void
  setError(message: string): void
  applyBoards(data: KanbanBoards): void
  setBoard(board: string | null, notice?: string | null): void
  applyTasks(board: string, data: KanbanTasks, now?: number): void
  setAssignee(a: string): void
  setQuery(q: string): void
  setShowAllDone(on: boolean): void
  clearNotice(): void
  openTask(id: string): void
  back(): void
  closeTask(): void
  setDetail(entry: TaskDetailEntry): void
  reset(): void
}

const EMPTY = {
  status: 'idle' as KanbanState['status'],
  error: null as string | null,
  boards: [] as KanbanBoard[],
  boardErrors: [] as KanbanBoards['errors'],
  board: null as string | null,
  tasks: [] as KanbanTasks['tasks'],
  archived: 0,
  truncated: false,
  receivedAt: null as number | null,
  assignee: 'all',
  query: '',
  showAllDone: false,
  notice: null as string | null,
  selectedId: null as string | null,
  trail: [] as string[],
  detail: null as TaskDetailEntry | null,
  ask: null as KanbanAsk | null,
  pending: false,
  note: null as { ok: boolean; text: string } | null,
  newOpen: false
}

export const useKanban = create<KanbanState>()((set) => ({
  ...EMPTY,
  setStatus: (status) => set({ status }),
  setError: (error) => set({ status: 'error', error }),
  applyBoards: (data) => set({ boards: data.boards, boardErrors: data.errors }),
  // A different board: its tasks and the filters of the old one do not apply.
  setBoard: (board, notice = null) =>
    set((s) =>
      s.board === board
        ? { notice: notice ?? s.notice }
        : { board, tasks: [], archived: 0, truncated: false, assignee: 'all', query: '', showAllDone: false, selectedId: null, trail: [], detail: null, notice, status: 'loading', ask: null, note: null, newOpen: false }
    ),
  applyTasks: (board, data, now = Date.now()) =>
    set((s) => (s.board === board ? { tasks: data.tasks, archived: data.archived, truncated: data.truncated, receivedAt: now, status: 'ok', error: null } : s)),
  setAssignee: (assignee) => set({ assignee }),
  setQuery: (query) => set({ query }),
  setShowAllDone: (showAllDone) => set({ showAllDone }),
  clearNotice: () => set({ notice: null }),
  openTask: (id) => set((s) => ({ selectedId: id, trail: s.selectedId && s.selectedId !== id ? [...s.trail, s.selectedId] : s.trail, detail: { status: 'loading' }, ask: null, note: s.selectedId === id ? s.note : null })),
  back: () => set((s) => (s.trail.length === 0 ? s : { selectedId: s.trail[s.trail.length - 1]!, trail: s.trail.slice(0, -1), detail: { status: 'loading' }, ask: null, note: null })),
  closeTask: () => set({ selectedId: null, trail: [], detail: null, ask: null, note: null }),
  setDetail: (detail) => set({ detail }),
  reset: () => set({ ...EMPTY })
}))
