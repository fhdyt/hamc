import { useEffect, useMemo, useState } from 'react'
import type { SessionDetail } from '@shared/events'
import { Modal } from '../../components/Modal'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { clockWithDay } from '../../lib/feed'
import { useAgents } from '../../stores/agents'
import { useFeed } from '../../stores/feed'
import { FeedRow } from './FeedRow'

type Load = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; detail: SessionDetail }

const ERRORS: Record<string, string> = {
  not_found: 'This session is no longer in the database.',
  timeout: 'The server took too long to answer.',
  'not-connected': 'Not connected to the server.'
}

export function SessionModal() {
  const target = useFeed((s) => s.session)
  const close = useFeed((s) => s.closeSession)
  if (!target) return null
  return <SessionBody key={target.sessionId} profile={target.profile} first={target.sessionId} onClose={close} />
}

function SessionBody({ profile, first, onClose }: { profile: string; first: string; onClose: () => void }) {
  const [sessionId, setSessionId] = useState(first)
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const agents = useAgents((s) => s.agents)
  const name = useMemo(() => agents.find((a) => a.profile === profile)?.displayName ?? profile, [agents, profile])

  useEffect(() => {
    let live = true
    setLoad({ status: 'loading' })
    void window.mc.feed.session(profile, sessionId).then((res) => {
      if (!live) return
      setLoad(res.ok ? { status: 'ok', detail: res.data } : { status: 'error', error: ERRORS[res.error] ?? 'Could not load this session.' })
    })
    return () => {
      live = false
    }
  }, [profile, sessionId, attempt])

  return (
    <Modal title={`Session · ${name}`} onClose={onClose} width={860}>
      <div className="fsession">
        {load.status === 'loading' && <Skeleton rows={5} />}
        {load.status === 'error' && <ErrorState title="Could not open the session" why={load.error} onRetry={() => setAttempt(attempt + 1)} />}
        {load.status === 'ok' && <SessionDetailView detail={load.detail} name={name} onPick={setSessionId} />}
      </div>
    </Modal>
  )
}

function SessionDetailView({ detail, name, onPick }: { detail: SessionDetail; name: string; onPick: (id: string) => void }) {
  const s = detail.session
  return (
    <>
      <dl className="kv" style={{ margin: 0 }}>
        <dt>session</dt>
        <dd className="num">{s.id}</dd>
        <dt>source</dt>
        <dd>{s.source ?? 'unknown'}</dd>
        {s.model && (
          <>
            <dt>model</dt>
            <dd>{s.model}</dd>
          </>
        )}
        {s.title && (
          <>
            <dt>title</dt>
            <dd>{s.title}</dd>
          </>
        )}
        {s.startedAt !== null && (
          <>
            <dt>started</dt>
            <dd>{clockWithDay(s.startedAt)}</dd>
          </>
        )}
        {s.parentSessionId && (
          <>
            <dt>parent</dt>
            <dd>
              <button type="button" className="fr-more" onClick={() => onPick(s.parentSessionId!)}>
                {s.parentSessionId}
              </button>
            </dd>
          </>
        )}
        {detail.children.length > 0 && (
          <>
            <dt>sub-sessions</dt>
            <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {detail.children.map((c) => (
                <button key={c.id} type="button" className="tag fr-link" onClick={() => onPick(c.id)}>
                  {c.source ?? 'subagent'} · {c.id}
                </button>
              ))}
            </dd>
          </>
        )}
      </dl>
      {detail.items.length === 0 ? (
        <EmptyState title="No messages in this session" />
      ) : (
        <div className="fsession-list" role="list" aria-label={`Conversation of ${name}`}>
          {detail.items.map((it) => (
            <div key={it.id} role="listitem">
              <FeedRow item={it} name={name} />
            </div>
          ))}
        </div>
      )}
      {detail.more && <span className="fcount">Showing the most recent part of a long session.</span>}
    </>
  )
}
