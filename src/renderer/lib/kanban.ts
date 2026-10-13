import type { KanbanBoard, KanbanTask } from '@shared/events'
import { ARCHIVED_STATUS, COLUMN_IDS, COLUMN_LABEL, type ColumnId } from '@shared/kanban'
import { formatAge } from './format'

/** The Done column shows this many cards until the reader asks for more. */
export const DONE_VISIBLE = 30

/** The assignee filter value for tasks nobody holds. */
export const UNASSIGNED = '__none__'

export type ColumnKey = ColumnId | 'other'

export interface Column {
  id: ColumnKey
  label: string
  /** The cards shown. */
  tasks: KanbanTask[]
  /** All cards of this column. */
  total: number
  /** Cards cut from the end (only the Done column is cut). */
  hidden: number
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase()

/** The column a status word belongs to; any word without a column of its own is `other`. */
export function columnOf(status: string): ColumnKey {
  const s = norm(status)
  return (COLUMN_IDS as readonly string[]).includes(s) ? (s as ColumnId) : 'other'
}

const byPriorityThenNewest = (a: KanbanTask, b: KanbanTask): number =>
  b.priority - a.priority || (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id)

/** Columns in board order. `scheduled` and `other` appear only when they have tasks; archived tasks never do. */
export function buildColumns(tasks: readonly KanbanTask[], showAllDone = false): Column[] {
  const groups = new Map<ColumnKey, KanbanTask[]>()
  for (const t of tasks) {
    if (norm(t.status) === ARCHIVED_STATUS) continue
    const key = columnOf(t.status)
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  const order: ColumnKey[] = [...COLUMN_IDS, 'other']
  const out: Column[] = []
  for (const id of order) {
    const all = (groups.get(id) ?? []).sort(byPriorityThenNewest)
    if ((id === 'scheduled' || id === 'other') && all.length === 0) continue
    const cut = id === 'done' && !showAllDone && all.length > DONE_VISIBLE
    out.push({ id, label: COLUMN_LABEL[id], tasks: cut ? all.slice(0, DONE_VISIBLE) : all, total: all.length, hidden: cut ? all.length - DONE_VISIBLE : 0 })
  }
  return out
}

/** Assignee (`all`, UNASSIGNED or a name) and text (id, title, assignee, creator) filters. */
export function filterTasks(tasks: readonly KanbanTask[], assignee: string, query: string): KanbanTask[] {
  const q = norm(query)
  return tasks.filter((t) => {
    if (assignee === UNASSIGNED ? t.assignee !== null && t.assignee !== '' : assignee !== 'all' && t.assignee !== assignee) return false
    if (!q) return true
    return [t.id, t.title, t.assignee, t.createdBy].some((v) => norm(v).includes(q))
  })
}

export function assigneeOptions(tasks: readonly KanbanTask[]): { names: string[]; unassigned: boolean } {
  const names = new Set<string>()
  let unassigned = false
  for (const t of tasks) {
    if (t.assignee) names.add(t.assignee)
    else unassigned = true
  }
  return { names: [...names].sort((a, b) => a.localeCompare(b)), unassigned }
}

export function boardSummary(tasks: readonly KanbanTask[]): { total: number; running: number; blocked: number } {
  let running = 0
  let blocked = 0
  for (const t of tasks) {
    const c = columnOf(t.status)
    if (c === 'running') running++
    else if (c === 'blocked') blocked++
  }
  return { total: tasks.length, running, blocked }
}

/** `P2` for a priority above zero; which direction means urgent is not known, so zero shows nothing. */
export const priorityLabel = (p: number): string | null => (p > 0 ? `P${p}` : null)

/** How long ago the task started (running) or was created; empty when unknown. */
export function ageLabel(t: KanbanTask, nowSec: number): string {
  const since = columnOf(t.status) === 'running' && t.startedAt !== null ? t.startedAt : t.createdAt
  return since === null ? '' : formatAge(Math.max(0, nowSec - since))
}

export function taskTitle(t: { title: string | null }): string {
  return t.title && t.title.trim() ? t.title : '(untitled)'
}

const PAYLOAD_CUT = 120

/** An event payload on one line: the keys of a JSON object as `key: value`, anything else as written. */
export function payloadSummary(payload: string | null): string {
  if (!payload) return ''
  let text = payload.trim()
  if (text.startsWith('{')) {
    try {
      const o = JSON.parse(text) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        text = Object.entries(o as Record<string, unknown>)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(', ')
      }
    } catch {
      /* not JSON: shown as written */
    }
  }
  return text.length > PAYLOAD_CUT ? `${text.slice(0, PAYLOAD_CUT)}…` : text
}

/** The board to open: the saved one if it still exists, else the first readable board with tasks, else `default`, else the first. */
export function pickBoard(boards: readonly KanbanBoard[], saved: string): string | null {
  if (boards.some((b) => b.slug === saved)) return saved
  const withTasks = boards.find((b) => b.readable && b.tasks > 0)
  if (withTasks) return withTasks.slug
  if (boards.some((b) => b.slug === 'default')) return 'default'
  return boards[0]?.slug ?? null
}
