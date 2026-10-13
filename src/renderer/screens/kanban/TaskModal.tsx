import type { ReactNode } from 'react'
import type { KanbanTaskDetail } from '@shared/events'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { Modal } from '../../components/Modal'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { agentColor } from '../../lib/agentColor'
import { clockWithDay } from '../../lib/feed'
import { formatBytes } from '../../lib/format'
import { COLUMN_COLOR, columnOf, payloadSummary, priorityLabel, taskTitle } from '../../lib/kanban'
import { closeTask, openTask, retryTask, taskBack } from '../../kanbanActions'
import { useAgents } from '../../stores/agents'
import { useFeed } from '../../stores/feed'
import { useKanban } from '../../stores/kanban'

const when = (ts: number | null): string => (ts === null ? 'unknown' : clockWithDay(ts))

function Person({ profile, nameOf }: { profile: string | null; nameOf(p: string): string }) {
  if (!profile) return <span className="kt-dim">none</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Avatar name={nameOf(profile)} profile={profile} size={16} />
      <span style={{ color: agentColor(profile), fontWeight: 600 }}>{nameOf(profile)}</span>
    </span>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="kt-sec" aria-label={title}>
      <h3>
        {title}
        {count !== undefined ? ` · ${count}` : ''}
      </h3>
      {children}
    </section>
  )
}

function Detail({ d, nameOf }: { d: KanbanTaskDetail; nameOf(p: string): string }) {
  const t = d.task
  const col = columnOf(t.status)
  const known = useAgents((a) => a.agents.some((x) => x.profile === t.assignee))
  const prio = priorityLabel(t.priority)
  const canOpen = !!t.sessionId && !!t.assignee && known
  return (
    <div className="kt">
      <div className="kt-top" style={{ ['--pc' as string]: COLUMN_COLOR[col] }}>
        <span className="num kt-dim">{t.id}</span>
        <span className="kt-status">{t.status || 'no status'}</span>
        {prio && (
          <span style={{ color: '#bd93f9', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="flag" size={11} />
            {prio}
          </span>
        )}
      </div>
      <h3 style={{ margin: 0, fontSize: 15, color: '#f8f8f2', overflowWrap: 'anywhere' }}>{taskTitle(t)}</h3>
      <div className="kt-cols">
        <div className="kt-main">
          <div>{t.body && t.body.trim() ? <Markdown text={t.body} /> : <span className="kt-dim">No description</span>}</div>
          {t.result && (
            <Section title="Result">
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.result}</div>
            </Section>
          )}
          {t.lastFailureError && (
            <Section title="Last failure">
              <div className="kt-err">{t.lastFailureError}</div>
            </Section>
          )}
          <Section title="Comments" count={d.comments.length}>
            {d.comments.length === 0 && <span className="kt-dim">No comments yet</span>}
            {d.comments.map((c) => (
              <div key={c.id} className="kt-comment">
                {c.author ? <Avatar name={nameOf(c.author)} profile={c.author} size={22} /> : <span style={{ width: 22 }} />}
                <div className="kt-bubble">
                  <span>
                    <span style={{ color: c.author ? agentColor(c.author) : '#a9b2d3', fontWeight: 600 }}>{c.author ? nameOf(c.author) : 'unknown'}</span> <span className="kt-dim">· {when(c.createdAt)}</span>
                  </span>
                  <div>{c.body}</div>
                </div>
              </div>
            ))}
          </Section>
        </div>
        <aside className="kt-side" aria-label="Task details">
          <dl className="kt-grid" style={{ margin: 0 }}>
            <dt>Assignee</dt>
            <dd>
              <Person profile={t.assignee} nameOf={nameOf} />
            </dd>
            <dt>Created by</dt>
            <dd>
              <Person profile={t.createdBy} nameOf={nameOf} />
            </dd>
            <dt>Created</dt>
            <dd>{when(t.createdAt)}</dd>
            <dt>Started</dt>
            <dd>{when(t.startedAt)}</dd>
            <dt>Completed</dt>
            <dd>{when(t.completedAt)}</dd>
            {t.blockKind && (
              <>
                <dt>Blocked by</dt>
                <dd>{t.blockKind}</dd>
              </>
            )}
            {t.failures > 0 && (
              <>
                <dt>Failures</dt>
                <dd>{t.failures} in a row</dd>
              </>
            )}
            {t.skills && (
              <>
                <dt>Skills</dt>
                <dd>{t.skills}</dd>
              </>
            )}
            {t.modelOverride && (
              <>
                <dt>Model</dt>
                <dd>{t.modelOverride}</dd>
              </>
            )}
            {t.providerOverride && (
              <>
                <dt>Provider</dt>
                <dd>{t.providerOverride}</dd>
              </>
            )}
          </dl>
          {canOpen && (
            <button type="button" className="cb" onClick={() => useFeed.getState().openSession(t.assignee!, t.sessionId!)}>
              Open session
            </button>
          )}
          <Section title="Runs" count={d.runs.length}>
            {d.runs.length === 0 && <span className="kt-dim">No runs yet</span>}
            {d.runs.map((r) => (
              <div key={r.id} className="kt-run">
                <span>
                  <strong>{r.profile ? nameOf(r.profile) : 'unknown agent'}</strong> · {r.status ?? 'unknown'}
                  {r.outcome ? ` · ${r.outcome}` : ''}
                </span>
                <span className="kt-dim">
                  {when(r.startedAt)}
                  {r.endedAt !== null ? ` → ${when(r.endedAt)}` : ''}
                </span>
                {r.summary && <span>{r.summary}</span>}
                {r.error && <span className="kt-err">{r.error}</span>}
              </div>
            ))}
          </Section>
          <Section title="Links">
            {d.parents.length === 0 && d.children.length === 0 && <span className="kt-dim">No linked tasks</span>}
            {d.parents.length > 0 && <span className="kt-dim">Waits for</span>}
            {d.parents.map((p) => (
              <button key={`p-${p.id}`} type="button" className="kt-link" onClick={() => void openTask(p.id)} aria-label={`Waits for ${p.id}: ${taskTitle(p)}`}>
                <span className="num kt-dim">{p.id}</span>
                <span>{taskTitle(p)}</span>
                <span className="kt-dim" style={{ marginLeft: 'auto' }}>
                  {p.status}
                </span>
              </button>
            ))}
            {d.children.length > 0 && <span className="kt-dim">Unblocks</span>}
            {d.children.map((p) => (
              <button key={`c-${p.id}`} type="button" className="kt-link" onClick={() => void openTask(p.id)} aria-label={`Unblocks ${p.id}: ${taskTitle(p)}`}>
                <span className="num kt-dim">{p.id}</span>
                <span>{taskTitle(p)}</span>
                <span className="kt-dim" style={{ marginLeft: 'auto' }}>
                  {p.status}
                </span>
              </button>
            ))}
          </Section>
          <Section title="Activity" count={d.events.length}>
            {d.events.length === 0 && <span className="kt-dim">No activity yet</span>}
            {d.events.map((e) => (
              <div key={e.id} className="kt-ev">
                <span className="dot" style={{ marginTop: 5, background: '#8be9fd' }} aria-hidden="true" />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span>
                    {e.kind ?? 'event'}
                    {payloadSummary(e.payload) ? <span className="kt-dim"> · {payloadSummary(e.payload)}</span> : null}
                  </span>
                  <span className="kt-dim" style={{ fontSize: 10 }}>
                    {when(e.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </Section>
          {d.attachments.length > 0 && (
            <Section title="Attachments" count={d.attachments.length}>
              {d.attachments.map((a) => (
                <div key={a.id} style={{ overflowWrap: 'anywhere' }}>
                  {a.filename ?? 'unnamed'}
                  {a.size !== null ? <span className="kt-dim"> · {formatBytes(a.size)}</span> : null}
                </div>
              ))}
            </Section>
          )}
        </aside>
      </div>
    </div>
  )
}

export function TaskModal({ nameOf }: { nameOf(profile: string): string }) {
  const id = useKanban((s) => s.selectedId)
  const detail = useKanban((s) => s.detail)
  const canBack = useKanban((s) => s.trail.length > 0)
  if (!id) return null
  return (
    <Modal title={`Task ${id}`} onClose={closeTask} width={900}>
      {canBack && (
        <button type="button" className="cb" style={{ marginBottom: 10 }} onClick={() => void taskBack()}>
          <Icon name="chevs-left" size={12} /> Back
        </button>
      )}
      {!detail || detail.status === 'loading' ? (
        <Skeleton rows={5} />
      ) : detail.status === 'error' ? (
        <ErrorState title="Could not read this task" why={detail.message} onRetry={() => void retryTask()} />
      ) : detail.status === 'gone' ? (
        <EmptyState title="This task is no longer on the board." />
      ) : (
        <Detail d={detail.data} nameOf={nameOf} />
      )}
    </Modal>
  )
}
