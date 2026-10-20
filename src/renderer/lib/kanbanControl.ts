import { ARCHIVED_STATUS, KANBAN_LIMITS, type KanbanAction } from '@shared/kanban'

/** The status buttons of the task dialog, in this order. Create, assign and comment have their own controls. */
export type StatusAction = Extract<KanbanAction, 'complete' | 'block' | 'unblock' | 'promote' | 'archive'>

const BLOCKABLE = new Set(['triage', 'todo', 'ready', 'running', 'review', 'scheduled'])
const UNBLOCKABLE = new Set(['blocked', 'scheduled'])
const PROMOTABLE = new Set(['todo', 'blocked'])

/** What a task in this status can be moved to (Hermes still judges; it refuses, for example, a promote with open parents). */
export function actionsFor(task: { status: string }): StatusAction[] {
  const s = task.status
  if (s === ARCHIVED_STATUS) return []
  if (s === 'done') return ['archive']
  const out: StatusAction[] = ['complete']
  if (BLOCKABLE.has(s)) out.push('block')
  if (UNBLOCKABLE.has(s)) out.push('unblock')
  if (PROMOTABLE.has(s)) out.push('promote')
  out.push('archive')
  return out
}

export const ACTION_LABEL: Record<StatusAction, string> = {
  complete: 'Complete',
  block: 'Block',
  unblock: 'Unblock',
  promote: 'Promote to ready',
  archive: 'Archive'
}

/** The question of the confirm. A task a worker holds says so: Hermes decides what happens to that run. */
export function confirmText(action: StatusAction, task: { status: string; title: string | null; assignee: string | null }): string {
  const name = `"${task.title ?? 'Untitled task'}"`
  const held = task.status === 'running' ? ` ${task.assignee ?? 'A worker'} is working on it; Hermes decides what happens to that run.` : ''
  switch (action) {
    case 'complete':
      return `Mark ${name} done?${held}`
    case 'block':
      return `Block ${name}? It waits for a person until it is unblocked.${held}`
    case 'unblock':
      return `Unblock ${name}? It goes back to ready (or to do while its parents are open).`
    case 'promote':
      return `Move ${name} to ready? Hermes refuses while its parent tasks are open.`
    case 'archive':
      return `Archive ${name}? It leaves the board; Hermes keeps it in kanban.db.${held}`
  }
}

/** The first problem of the New task form, or null when it can be sent. */
export function newTaskProblem(d: { title: string; body: string; priority: string }): string | null {
  if (!d.title.trim()) return 'Give the task a title.'
  if (d.title.length > KANBAN_LIMITS.title) return `Keep the title under ${KANBAN_LIMITS.title} characters.`
  if (/[\r\n]/.test(d.title)) return 'Keep the title on one line.'
  if (d.body.length > KANBAN_LIMITS.body) return 'The description is too long.'
  if (d.priority.trim() !== '') {
    const n = Number(d.priority)
    if (!/^-?\d+$/.test(d.priority.trim()) || Math.abs(n) > KANBAN_LIMITS.priority) return 'Priority is a whole number from -1000 to 1000.'
  }
  return null
}
