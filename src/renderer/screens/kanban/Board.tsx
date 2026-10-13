import type { KanbanTask } from '@shared/events'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { COLUMN_COLOR, ageLabel, buildColumns, columnOf, priorityLabel, taskTitle } from '../../lib/kanban'
import { openTask } from '../../kanbanActions'

interface Props {
  tasks: readonly KanbanTask[]
  nameOf(profile: string): string
  showAllDone: boolean
  onShowAllDone(): void
}

function Card({ t, nameOf, nowSec }: { t: KanbanTask; nameOf(profile: string): string; nowSec: number }) {
  const prio = priorityLabel(t.priority)
  const running = columnOf(t.status) === 'running'
  const bad = t.failed || t.failures > 0
  const col = columnOf(t.status)
  return (
    <button type="button" className="kb-card" data-status={col} aria-label={`Task ${t.id}: ${taskTitle(t)}`} onClick={() => void openTask(t.id)} style={{ ['--pc' as string]: COLUMN_COLOR[col] }}>
      <span className="kb-card-top">
        <span className="num kb-id" title={t.id}>
          {t.id}
        </span>
        {running && (
          <span className="mc-dots" style={{ color: '#8be9fd' }} aria-label="Running">
            <i />
            <i />
            <i />
          </span>
        )}
        {col === 'other' && <span className="kb-word">{t.status || 'no status'}</span>}
        {prio && (
          <span className="kb-prio" title={`Priority ${t.priority}`}>
            <Icon name="flag" size={10} />
            {prio}
          </span>
        )}
      </span>
      <span className="kb-title">{taskTitle(t)}</span>
      {(bad || (col === 'blocked' && t.blockKind)) && (
        <span className="kb-flags">
          {bad && (
            <span className="kb-fail" title={t.failures > 0 ? `${t.failures} failed ${t.failures === 1 ? 'run' : 'runs'} in a row` : 'The last run failed'}>
              <Icon name="alert" size={10} />
              {t.failures > 1 ? `failed ×${t.failures}` : 'failed'}
            </span>
          )}
          {col === 'blocked' && t.blockKind && <span className="kb-word">{t.blockKind}</span>}
        </span>
      )}
      <span className="kb-card-foot">
        {t.assignee ? (
          <>
            <Avatar name={nameOf(t.assignee)} profile={t.assignee} size={18} />
            <span className="kb-who" style={{ color: agentColor(t.assignee) }}>
              {nameOf(t.assignee)}
            </span>
          </>
        ) : (
          <span className="kb-who" style={{ color: '#8b95bd' }}>
            Unassigned
          </span>
        )}
        {t.comments > 0 && (
          <span className="kb-meta" title={`${t.comments} ${t.comments === 1 ? 'comment' : 'comments'}`}>
            <Icon name="message" size={10} />
            {t.comments}
          </span>
        )}
        <span className="kb-meta">{ageLabel(t, nowSec)}</span>
      </span>
    </button>
  )
}

export function Board({ tasks, nameOf, showAllDone, onShowAllDone }: Props) {
  const now = useNow(30_000)
  const nowSec = now / 1000
  const cols = buildColumns(tasks, showAllDone)
  return (
    <div className="kb-cols" role="list" aria-label="Board columns">
      {cols.map((c) => (
        <section key={c.id} role="listitem" className="kb-col" aria-label={`${c.label}, ${c.total} ${c.total === 1 ? 'task' : 'tasks'}`}>
          <div className="kb-col-head">
            <span className="dot" style={{ background: COLUMN_COLOR[c.id] }} aria-hidden="true" />
            <h2>{c.label}</h2>
            <span className="num kb-count">{c.total}</span>
          </div>
          <div className="kb-cards">
            {c.tasks.map((t) => (
              <Card key={t.id} t={t} nameOf={nameOf} nowSec={nowSec} />
            ))}
            {c.total === 0 && <div className="kb-none">No tasks</div>}
            {c.hidden > 0 && (
              <button type="button" className="cb" onClick={onShowAllDone}>
                Show {c.hidden} more
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
