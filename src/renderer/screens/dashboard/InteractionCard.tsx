import { useEffect, useState } from 'react'
import type { InteractionDetail } from '@shared/events'
import type { InteractionDetailArgs } from '@shared/ipc'
import { Icon } from '../../components/Icon'
import { KIND_COLOR, KIND_LABEL, KINDS, type GEdge, type GNode } from '../../lib/agentGraph'
import { clockWithDay } from '../../lib/feed'
import { useFeed } from '../../stores/feed'
import { useInteractions } from '../../stores/interactions'

const ERRORS: Record<string, string> = {
  not_found: 'The source of this interaction is no longer on the server.',
  timeout: 'The server took too long to answer.',
  'not-connected': 'Not connected to the server.'
}

type Load = { key: string; state: 'loading' } | { key: string; state: 'error'; error: string } | { key: string; state: 'ok'; detail: InteractionDetail }

/** What to ask the server for an edge or a node; null when the thing has nothing to read (an agent, a task without a number). */
export function detailArgs(edge: GEdge | null, node: GNode | null): InteractionDetailArgs | null {
  if (edge) {
    if (edge.kind === 'message') return { kind: 'message', from: edge.from, to: edge.to }
    if (edge.kind === 'kanban') {
      const id = (edge.label ?? '').replace(/^#/, '')
      return /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? { kind: 'kanban', id } : null
    }
    return { kind: edge.kind, id: edge.to }
  }
  if (node?.kind === 'room') return { kind: 'room', id: node.id }
  if (node?.kind === 'sub') return { kind: 'delegate', id: node.id }
  return null
}

interface Props {
  edge: GEdge | null
  node: GNode | null
  counts: Record<(typeof KINDS)[number], number>
  labelOf(id: string): string
  onClose(): void
}

/** The card under the graph: kind, sender to receiver, the latest text, the time, where it was read and a link to the session. */
export function InteractionCard({ edge, node, counts, labelOf, onClose }: Props) {
  const args = detailArgs(edge, node)
  const key = args ? JSON.stringify(args) + (edge ? `@${edge.lastTs}:${edge.count}` : '') : ''
  const [load, setLoad] = useState<Load | null>(null)
  const members = useInteractions((s) => (node?.kind === 'room' ? s.data?.rooms.find((r) => r.id === node.id)?.members.join(', ') : undefined))

  useEffect(() => {
    if (!args) {
      setLoad(null)
      return
    }
    let live = true
    setLoad((cur) => (cur && cur.key.split('@')[0] === key.split('@')[0] && cur.state === 'ok' ? cur : { key, state: 'loading' }))
    void window.mc.interactions.detail(args).then((res) => {
      if (!live) return
      setLoad(res.ok ? { key, state: 'ok', detail: res.data } : { key, state: 'error', error: ERRORS[res.error] ?? 'Could not read this interaction.' })
    })
    return () => {
      live = false
    }
    // `args` is derived from `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const kind = edge?.kind ?? (node?.kind === 'room' ? 'room' : node?.kind === 'sub' ? 'delegate' : null)
  const color = kind ? KIND_COLOR[kind] : '#A9B2D3'
  const title = edge
    ? `${edge.kind === 'kanban' ? `kanban ${edge.label ?? ''}` : edge.kind === 'message' ? 'message_agent' : edge.kind === 'room' ? 'group room' : 'delegate_task'}${edge.status ? ` · ${edge.status}` : ''}`
    : node?.kind === 'room'
      ? `group room ${node.label}`
      : node?.kind === 'sub'
        ? `delegate_task · ${node.running ? 'running' : 'done'}`
        : `${node?.label ?? ''}${node?.status ? ` · ${node.status}` : ''}`
  const route = edge ? `${labelOf(edge.from)} → ${labelOf(edge.to)}` : node?.kind === 'sub' ? `${labelOf(node.parent ?? '')} → subagent` : node?.kind === 'agent' ? KINDS.map((k) => `${KIND_LABEL[k]} ${counts[k]}`).join(' · ') : ''
  const detail = load?.state === 'ok' ? load.detail : null

  return (
    <aside className="ag-card" aria-label="Interaction details">
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <i className="ag-dot" style={{ background: color }} aria-hidden="true" />
        <strong style={{ color }}>{title}</strong>
        <button type="button" className="ib sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close details" title="Close">
          <Icon name="x" size={13} />
        </button>
      </header>
      {route && <div className="ag-route">{route}</div>}
      {!args && node?.kind === 'agent' && <p className="ag-text">{KINDS.some((k) => counts[k] > 0) ? 'Select an edge label to open an interaction.' : 'No interactions with other agents in this window.'}</p>}
      {node?.kind === 'room' && <div className="ag-route">members: {members ?? ''}</div>}
      {load?.state === 'loading' && <p className="ag-text">Reading…</p>}
      {load?.state === 'error' && <p className="ag-text" role="alert" style={{ color: '#FFB86C' }}>{load.error}</p>}
      {detail && (
        <>
          {detail.title && <div className="ag-title">{detail.title}</div>}
          {detail.text && <p className="ag-text">{detail.text}{detail.truncated ? ' …' : ''}</p>}
          <footer className="ag-meta">
            {detail.ts !== null && <span>{clockWithDay(detail.ts)}</span>}
            <span>{detail.source}</span>
            {detail.sessionId && detail.profile && (
              <button type="button" className="cb" onClick={() => useFeed.getState().openSession(detail.profile!, detail.sessionId!)}>
                Open session
              </button>
            )}
          </footer>
        </>
      )}
    </aside>
  )
}

