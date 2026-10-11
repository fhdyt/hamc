import { useState } from 'react'
import logoUrl from '../../assets/logo-mark.png'
import { Icon } from '../../components/Icon'
import { StaleBanner } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { activeCount } from '../../lib/roster'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'
import { EditConnectionDialog } from '../EditConnectionDialog'

export function StatusBlock() {
  const agents = useAgents((s) => s.agents)
  const receivedAt = useAgents((s) => s.receivedAt)
  const status = useConn((s) => s.status)
  const saved = useConn((s) => s.saved)
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const active = activeCount(agents)
  const live = status.state === 'connected'

  return (
    <div className="status-block">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={logoUrl} width={36} height={36} alt="" />
        <div style={{ color: '#A9B2D3', fontSize: 10, fontWeight: 700, letterSpacing: 1.5, lineHeight: 1.3 }}>
          HERMES AGENT
          <br />
          MISSION CONTROL
        </div>
      </div>
      <div role="status" aria-live="polite">
        {agents.length === 0 ? (
          <div style={{ color: '#A9B2D3' }}>{live ? 'Looking for agents…' : 'No agent data yet'}</div>
        ) : (
          <>
            <div className="big-num count">{active}</div>
            <div className="of">
              active agent{active === 1 ? '' : 's'} of {agents.length}
            </div>
          </>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {saved && <span className="chip">{saved.username}@{saved.host}:{saved.port}</span>}
        <button type="button" className="cb" onClick={() => setEditing(true)}>
          <Icon name="edit" size={12} /> Edit connection
        </button>
      </div>
      {!live && receivedAt !== null && <StaleBanner receivedAt={receivedAt} now={now} label={status.state === 'reconnecting' ? 'Reconnecting' : 'Offline'} />}
      {editing && <EditConnectionDialog onClose={() => setEditing(false)} />}
    </div>
  )
}
