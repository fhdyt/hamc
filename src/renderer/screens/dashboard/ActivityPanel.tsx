import { useMemo } from 'react'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/Panel'
import { EmptyState, Skeleton } from '../../components/States'
import { agentColor } from '../../lib/agentColor'
import { KIND_COLOR, KIND_LABEL, clock } from '../../lib/feed'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { useFeed } from '../../stores/feed'

const MAX_ROWS = 12

/** The latest feed items at a glance; a click opens the full feed in a dialog. */
export function ActivityPanel() {
  const items = useFeed((s) => s.items)
  const receivedAt = useFeed((s) => s.receivedAt)
  const openModal = useFeed((s) => s.openModal)
  const connState = useConn((s) => s.status.state)
  const agents = useAgents((s) => s.agents)
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const rows = useMemo(() => items.filter((i) => i.kind !== 'result').slice(0, MAX_ROWS), [items])

  const actions = (
    <button type="button" className="ib sm" onClick={openModal} aria-label="Open the live feed" title="Open the live feed">
      <Icon name="maximize" size={13} />
    </button>
  )

  return (
    <Panel variant="card" title="activity" label="Activity" className="grow" actions={actions}>
      {receivedAt === null ? (
        connState === 'connected' || connState === 'connecting' ? <Skeleton rows={4} /> : <EmptyState title="No activity yet" why="Items appear once Mission Control is connected." />
      ) : rows.length === 0 ? (
        <EmptyState title="No activity yet" why="When an agent talks, thinks or runs a tool, it shows up here." />
      ) : (
        <div role="list" aria-label="Latest activity" className="act-list">
          {rows.map((it) => (
            <button key={it.id} type="button" role="listitem" className="act-row" onClick={openModal} aria-label={`${names[it.profile] ?? it.profile}, ${KIND_LABEL[it.kind]}: ${it.text.slice(0, 80)}`}>
              <span className="num act-t">{clock(it.ts)}</span>
              <span className="dot" style={{ background: agentColor(it.profile) }} aria-hidden="true" />
              <span className="act-k" style={{ color: KIND_COLOR[it.kind] }}>{KIND_LABEL[it.kind]}</span>
              <span className="act-x">{it.text.replace(/\s+/g, ' ')}</span>
            </button>
          ))}
        </div>
      )}
    </Panel>
  )
}
