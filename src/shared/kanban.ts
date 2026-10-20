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

// ---- write actions (v2; checked against hermes_cli/kanban.py at tag v2026.8.31) -------------------------------

/** The eight Kanban writes of the app. Nothing else is ever sent to `hermes kanban`. */
export const KANBAN_ACTIONS = ['create', 'assign', 'comment', 'complete', 'block', 'unblock', 'promote', 'archive'] as const
export type KanbanAction = (typeof KANBAN_ACTIONS)[number]

/** Hermes's own board slug rule; a board outside it stays read-only. */
export const WRITE_BOARD_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
export const KANBAN_LIMITS = { title: 200, body: 16_000, comment: 8_000, reason: 500, result: 2_000, priority: 1000 } as const

export type KanbanActionRequest =
  | { action: 'create'; board: string; title: string; body?: string; assignee?: string; priority?: number; triage?: boolean }
  | { action: 'assign'; board: string; id: string; assignee: string }
  | { action: 'comment'; board: string; id: string; text: string }
  | { action: 'complete'; board: string; id: string; result?: string }
  | { action: 'block'; board: string; id: string; reason?: string }
  | { action: 'unblock' | 'promote' | 'archive'; board: string; id: string }

export type KanbanActionError = 'bad-input' | 'not-connected' | 'unknown-profile' | 'failed'
export type KanbanActionResult = { ok: true; output: string; taskId?: string } | { ok: false; error: KanbanActionError; detail?: string }

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const LINE_BREAK_OR_CONTROL = /[\u0000-\u001f\u007f]/
const text = (s: unknown, max: number, oneLine: boolean, required: boolean): s is string =>
  typeof s === 'string' && s.length <= max && !(oneLine ? LINE_BREAK_OR_CONTROL : CONTROL).test(s) && (!required || s.trim() !== '')
const optText = (s: unknown, max: number, oneLine: boolean): boolean => s === undefined || text(s, max, oneLine, false)
const okTask = (id: unknown): id is string => typeof id === 'string' && TASK_ID_RE.test(id) && !id.startsWith('-') && id !== '.' && id !== '..'
const okAssignee = (p: unknown): p is string => typeof p === 'string' && (p === 'none' || PROFILE_RE.test(p))

/**
 * The arguments after `hermes` for one write, or null when the request is not acceptable. The confirm previews
 * `hermes <these>`; main runs them with the real hermes path. `--board` always comes first (without it Hermes uses the
 * persisted current board); option values use `--opt=value` and free text follows `--`, so text never becomes a flag.
 */
export function kanbanActionArgs(r: KanbanActionRequest): string[] | null {
  if (!WRITE_BOARD_RE.test(r.board)) return null
  const head = ['kanban', '--board', r.board]
  if (r.action === 'create') {
    if (!text(r.title, KANBAN_LIMITS.title, true, true) || !optText(r.body, KANBAN_LIMITS.body, false)) return null
    if (r.assignee !== undefined && (!okAssignee(r.assignee) || r.assignee === 'none')) return null
    if (r.priority !== undefined && (!Number.isInteger(r.priority) || Math.abs(r.priority) > KANBAN_LIMITS.priority)) return null
    return [
      ...head,
      'create',
      '--json',
      ...(r.body ? [`--body=${r.body}`] : []),
      ...(r.assignee ? [`--assignee=${r.assignee}`] : []),
      ...(r.priority !== undefined && r.priority !== 0 ? [`--priority=${r.priority}`] : []),
      ...(r.triage ? ['--triage'] : []),
      '--',
      r.title
    ]
  }
  if (!okTask(r.id)) return null
  switch (r.action) {
    case 'assign':
      return okAssignee(r.assignee) ? [...head, 'assign', r.id, r.assignee] : null
    case 'comment':
      return text(r.text, KANBAN_LIMITS.comment, false, true) ? [...head, 'comment', r.id, '--', r.text] : null
    case 'complete':
      if (!optText(r.result, KANBAN_LIMITS.result, true)) return null
      return [...head, 'complete', r.id, ...(r.result ? [`--result=${r.result}`] : [])]
    case 'block':
      if (!optText(r.reason, KANBAN_LIMITS.reason, true)) return null
      return [...head, 'block', r.id, ...(r.reason ? ['--', r.reason] : [])]
    case 'unblock':
    case 'promote':
    case 'archive':
      return [...head, r.action, r.id]
    default:
      return null
  }
}

/** How an argument looks in the preview: quoted only when the shell would need it. */
function previewArg(a: string): string {
  return /^[A-Za-z0-9._:/=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`
}

export function kanbanCommandPreview(r: KanbanActionRequest): string | null {
  const args = kanbanActionArgs(r)
  return args ? `$ hermes ${args.map(previewArg).join(' ')}` : null
}
