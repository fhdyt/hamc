import { useState } from 'react'
import type { KanbanTaskDetail } from '@shared/events'
import { KANBAN_LIMITS, WRITE_BOARD_RE } from '@shared/kanban'
import { askKanbanAction } from '../../kanbanActions'
import { ACTION_LABEL, actionsFor, confirmText } from '../../lib/kanbanControl'
import { taskTitle } from '../../lib/kanban'
import { useAgents } from '../../stores/agents'
import { useKanban } from '../../stores/kanban'

type Task = KanbanTaskDetail['task']

/** True when the app may write to the board on screen (Hermes's slug rule). */
export function useWritable(): string | null {
  const board = useKanban((s) => s.board)
  return board && WRITE_BOARD_RE.test(board) ? board : null
}

/** Status buttons and the assignee of one task. Each opens the confirm with the exact command. */
export function TaskActions({ task, nameOf }: { task: Task; nameOf(p: string): string }) {
  const board = useWritable()
  const pending = useKanban((s) => s.pending)
  const agents = useAgents((s) => s.agents)
  if (!board) return <p className="kt-dim">This board's name is not one Hermes accepts for changes, so it is read-only here.</p>
  const actions = actionsFor(task)
  const archived = actions.length === 0
  const title = taskTitle(task)
  return (
    <div className="kw-actions" role="group" aria-label="Task actions">
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          className={`cb sm${a === 'archive' ? ' dng' : ''}`}
          disabled={pending}
          onClick={() =>
            askKanbanAction({
              req: { action: a, board, id: task.id },
              question: confirmText(a, { status: task.status, title, assignee: task.assignee }),
              ...(a === 'block' ? { field: 'reason' as const } : a === 'complete' ? { field: 'result' as const } : {})
            })
          }
        >
          {ACTION_LABEL[a]}
        </button>
      ))}
      {!archived && (
        <label className="kw-assign">
          <span>Assignee</span>
          <select
            className="fld"
            value={task.assignee ?? 'none'}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value
              askKanbanAction({
                req: { action: 'assign', board, id: task.id, assignee: v },
                question: v === 'none' ? `Unassign "${title}"?` : `Assign "${title}" to ${nameOf(v)}?`
              })
            }}
          >
            <option value="none">Unassigned</option>
            {task.assignee && !agents.some((a) => a.profile === task.assignee) && <option value={task.assignee}>{task.assignee}</option>}
            {agents.map((a) => (
              <option key={a.profile} value={a.profile}>
                {nameOf(a.profile)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}

/** Adds a comment to a task, after the confirm. */
export function CommentBox({ task }: { task: Task }) {
  const board = useWritable()
  const pending = useKanban((s) => s.pending)
  const [text, setText] = useState('')
  if (!board || task.status === 'archived') return null
  const trimmed = text.trim()
  return (
    <form
      className="kw-comment"
      onSubmit={(e) => {
        e.preventDefault()
        if (!trimmed) return
        askKanbanAction({ req: { action: 'comment', board, id: task.id, text: trimmed }, question: `Add this comment to "${taskTitle(task)}"?` })
        setText('')
      }}
    >
      <label className="vh" htmlFor="kw-comment-text">
        New comment
      </label>
      <textarea id="kw-comment-text" className="fld" rows={2} maxLength={KANBAN_LIMITS.comment} placeholder="Write a comment for the agents…" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="cb sm" disabled={pending || !trimmed}>
        Add comment
      </button>
    </form>
  )
}
