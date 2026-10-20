import { useState } from 'react'
import { KANBAN_LIMITS } from '@shared/kanban'
import { Modal } from '../../components/Modal'
import { askKanbanAction, closeNewTask } from '../../kanbanActions'
import { newTaskProblem } from '../../lib/kanbanControl'
import { useAgents } from '../../stores/agents'
import { useKanban } from '../../stores/kanban'
import { KanbanConfirm, KanbanNote } from './KanbanConfirm'
import { useWritable } from './TaskActions'

/** The New task dialog: title, description, assignee, priority and triage; Create opens the confirm. */
export function NewTask({ nameOf }: { nameOf(p: string): string }) {
  const open = useKanban((s) => s.newOpen)
  const board = useWritable()
  if (!open || !board) return null
  return <NewTaskBody board={board} nameOf={nameOf} />
}

function NewTaskBody({ board, nameOf }: { board: string; nameOf(p: string): string }) {
  const agents = useAgents((s) => s.agents)
  const pending = useKanban((s) => s.pending)
  const ask = useKanban((s) => s.ask)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState('')
  const [triage, setTriage] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    const p = newTaskProblem({ title, body, priority })
    setProblem(p)
    if (p) return
    const prio = priority.trim() ? Number(priority) : undefined
    askKanbanAction({
      req: {
        action: 'create',
        board,
        title: title.trim(),
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(assignee ? { assignee } : {}),
        ...(prio !== undefined ? { priority: prio } : {}),
        ...(triage ? { triage: true } : {})
      },
      question: `Create "${title.trim()}" on the ${board} board${assignee ? ` for ${nameOf(assignee)}` : ''}?`
    })
  }

  return (
    <Modal title="New task" onClose={closeNewTask} width={600}>
      <form className="kw-new" onSubmit={submit} noValidate>
        <label className="kw-field">
          <span>Title</span>
          <input className="fld" value={title} maxLength={KANBAN_LIMITS.title} onChange={(e) => setTitle(e.target.value)} disabled={!!ask} aria-invalid={problem?.includes('title') ? true : undefined} />
        </label>
        <label className="kw-field">
          <span>Description (optional, markdown)</span>
          <textarea className="fld" rows={5} value={body} maxLength={KANBAN_LIMITS.body} onChange={(e) => setBody(e.target.value)} disabled={!!ask} />
        </label>
        <div className="kw-row">
          <label className="kw-field">
            <span>Assignee</span>
            <select className="fld" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!!ask}>
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.profile} value={a.profile}>
                  {nameOf(a.profile)}
                </option>
              ))}
            </select>
          </label>
          <label className="kw-field" style={{ maxWidth: 140 }}>
            <span>Priority</span>
            <input className="fld" inputMode="numeric" placeholder="0" value={priority} onChange={(e) => setPriority(e.target.value)} disabled={!!ask} />
          </label>
        </div>
        <label className="chk">
          <input type="checkbox" checked={triage} onChange={(e) => setTriage(e.target.checked)} disabled={!!ask} />
          <span>Put in triage (Hermes's specifier fleshes it out before work starts)</span>
        </label>
        {problem && (
          <p role="alert" className="kw-bad">
            {problem}
          </p>
        )}
        <KanbanNote />
        {ask ? (
          <KanbanConfirm />
        ) : (
          <div className="kw-btns">
            <button type="button" className="cb" onClick={closeNewTask}>
              Cancel
            </button>
            <button type="submit" className="cb pri" disabled={pending}>
              Create…
            </button>
          </div>
        )}
      </form>
    </Modal>
  )
}
