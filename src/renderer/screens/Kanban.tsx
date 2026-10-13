import { useEffect, useMemo } from 'react'
import { EmptyState, ErrorState, Skeleton } from '../components/States'
import { Icon } from '../components/Icon'
import { UNASSIGNED, assigneeOptions, boardSummary, filterTasks } from '../lib/kanban'
import { closeTask, openKanban, refreshKanban, retryKanban, selectBoard } from '../kanbanActions'
import { useAgents } from '../stores/agents'
import { useKanban } from '../stores/kanban'
import { Board } from './kanban/Board'
import { TaskModal } from './kanban/TaskModal'

const REFRESH_MS = 10_000

export function Kanban() {
  const s = useKanban()
  const agents = useAgents((a) => a.agents)
  const names = useMemo(() => new Map(agents.map((a) => [a.profile, a.displayName])), [agents])
  const nameOf = (profile: string): string => names.get(profile) ?? profile

  useEffect(() => {
    void openKanban()
    // The board is re-read quietly while the screen is shown and the window is visible.
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshKanban()
    }, REFRESH_MS)
    return () => {
      window.clearInterval(t)
      closeTask()
    }
  }, [])

  const options = useMemo(() => assigneeOptions(s.tasks), [s.tasks])
  const shown = useMemo(() => filterTasks(s.tasks, s.assignee, s.query), [s.tasks, s.assignee, s.query])
  const sum = useMemo(() => boardSummary(s.tasks), [s.tasks])
  const readable = s.boards.filter((b) => b.readable)
  const noBoards = s.status === 'ok' && s.boards.length === 0
  const loading = (s.status === 'idle' || s.status === 'loading') && s.tasks.length === 0
  const failedFirst = s.status === 'error' && s.tasks.length === 0 && s.boards.length === 0

  return (
    <div className="kb">
      <div className="kb-head">
        <h1 className="page-title">Kanban</h1>
        {readable.length > 0 && (
          <>
            <label className="vh" htmlFor="kb-board">
              Board
            </label>
            <select id="kb-board" className="fld" value={s.board ?? ''} onChange={(e) => void selectBoard(e.target.value)}>
              {readable.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.slug} ({b.tasks})
                </option>
              ))}
            </select>
          </>
        )}
        {s.board && s.tasks.length > 0 && (
          <span className="kb-sum">
            {sum.total} {sum.total === 1 ? 'task' : 'tasks'} · <span style={{ color: '#8be9fd' }}>{sum.running} running</span> · <span style={{ color: '#ff5555' }}>{sum.blocked} blocked</span>
          </span>
        )}
        {s.tasks.length > 0 && (
          <span className="kb-tools" role="search" aria-label="Task filters">
            <label className="vh" htmlFor="kb-assignee">
              Assignee
            </label>
            <select id="kb-assignee" className="fld" value={s.assignee} onChange={(e) => s.setAssignee(e.target.value)}>
              <option value="all">All assignees</option>
              {options.names.map((n) => (
                <option key={n} value={n}>
                  {nameOf(n)}
                </option>
              ))}
              {options.unassigned && <option value={UNASSIGNED}>Unassigned</option>}
              {s.assignee !== 'all' && s.assignee !== UNASSIGNED && !options.names.includes(s.assignee) && <option value={s.assignee}>{nameOf(s.assignee)}</option>}
            </select>
            <label className="vh" htmlFor="kb-q">
              Search tasks
            </label>
            <input id="kb-q" type="search" className="fld" autoComplete="off" spellCheck={false} placeholder="Search" value={s.query} onChange={(e) => s.setQuery(e.target.value)} />
          </span>
        )}
      </div>

      {s.notice && (
        <div className="banner" role="status">
          <Icon name="alert" size={12} />
          {s.notice}
          <button type="button" className="ib sm" style={{ marginLeft: 'auto' }} onClick={s.clearNotice} aria-label="Dismiss">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      {s.status === 'error' && s.tasks.length > 0 && (
        <div className="banner bad" role="alert">
          <Icon name="alert" size={12} />
          Could not refresh the board: {s.error}
          <button type="button" className="cb" style={{ marginLeft: 'auto' }} onClick={() => void retryKanban()}>
            <Icon name="refresh" size={12} /> Retry
          </button>
        </div>
      )}
      {s.boardErrors.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" size={12} />
          {s.boardErrors.length === 1 ? 'One board' : `${s.boardErrors.length} boards`} could not be read: {s.boardErrors.map((e) => e.slug).join(', ')}
        </div>
      )}
      {s.truncated && (
        <div className="banner" role="status">
          <Icon name="alert" size={12} />
          Showing the newest 1,000 tasks of this board.
        </div>
      )}

      {loading ? (
        <Skeleton rows={6} />
      ) : failedFirst ? (
        <ErrorState title="Could not read the Kanban boards" why={s.error ?? undefined} onRetry={() => void retryKanban()} />
      ) : noBoards ? (
        <EmptyState title="No Kanban board found" why="Hermes has no Kanban board here yet: no kanban.db was found in its home folder or under kanban/boards." />
      ) : s.board && s.status !== 'error' && s.tasks.length === 0 && s.archived === 0 ? (
        <EmptyState title="No tasks on this board" why="Tasks that agents create show up here. This screen is read-only." />
      ) : s.tasks.length > 0 || s.archived > 0 ? (
        <>
          <Board tasks={shown} nameOf={nameOf} showAllDone={s.showAllDone} onShowAllDone={() => s.setShowAllDone(true)} />
          {s.archived > 0 && (
            <p className="kb-foot">
              {s.archived} archived {s.archived === 1 ? 'task is' : 'tasks are'} hidden.
            </p>
          )}
        </>
      ) : null}

      {s.selectedId && <TaskModal nameOf={nameOf} />}
    </div>
  )
}
