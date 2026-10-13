/** Status words with their own column, in board order. `scheduled` is shown only when it has tasks. */
export const COLUMN_IDS = ['triage', 'todo', 'ready', 'running', 'blocked', 'scheduled', 'review', 'done'] as const
export type ColumnId = (typeof COLUMN_IDS)[number]

/** The seven columns of the PRD, always on the board. */
export const ALWAYS_COLUMNS: readonly ColumnId[] = ['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'done']

/** Any status word that has no column of its own lands in `other`. */
export const COLUMN_LABEL: Record<ColumnId | 'other', string> = {
  triage: 'Triage',
  todo: 'To do',
  ready: 'Ready',
  running: 'Running',
  blocked: 'Blocked',
  scheduled: 'Scheduled',
  review: 'Review',
  done: 'Done',
  other: 'Other'
}

/** `archived` tasks are counted but not shown. */
export const ARCHIVED_STATUS = 'archived'

/** A board slug as a directory name under `kanban/boards`; the collector maps it to a known path and never uses it as one. */
export const BOARD_RE = /^[A-Za-z0-9._-]{1,64}$/
export const TASK_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

export interface KanbanTasksArgs {
  board: string
}

export interface KanbanTaskArgs {
  board: string
  id: string
}
