import { setZoomLevel, stepZoomLevel } from '../actions'
import { Icon } from '../components/Icon'
import { NoticeBell } from '../components/Notices'
import { activeCount } from '../lib/roster'
import { serverAddress, serverName } from '../lib/servers'
import { zoomPercent } from '../lib/zoom'
import { useAgents } from '../stores/agents'
import { useConn } from '../stores/conn'
import { useMetrics } from '../stores/metrics'
import { useUi } from '../stores/ui'
import { useUpdate } from '../stores/update'
import { ServerMenu } from './ServerMenu'

const TONE: Record<string, { bg: string; text: string }> = {
  connected: { bg: '#2E6B40', text: '' },
  connecting: { bg: '#44475A', text: 'Connecting…' },
  reconnecting: { bg: '#6B5420', text: 'Reconnecting' },
  offline: { bg: '#6B2E2E', text: 'Offline' },
  idle: { bg: '#44475A', text: 'Not connected' }
}

export function StatusBar() {
  const status = useConn((s) => s.status)
  const saved = useConn((s) => s.saved)
  const caps = useConn((s) => s.capabilities)
  const agents = useAgents((s) => s.agents)
  const metrics = useMetrics((s) => s.latest)
  const zoom = useUi((s) => s.settings['ui.zoom'])
  const openSettings = useUi((s) => s.openSettings)
  const update = useUpdate((s) => s.state)

  const tone = TONE[status.state] ?? TONE['idle']!
  const who = saved ? serverName(saved) : 'No connection'
  const online = activeCount(agents)
  const detail =
    status.state === 'connected'
      ? `${status.latencyMs ?? '–'} ms`
      : status.state === 'reconnecting' || status.state === 'offline'
        ? `${tone.text}${status.attempt ? ` · attempt ${status.attempt}` : ''}${status.nextRetryInS ? ` · retry in ${status.nextRetryInS}s` : ''}`
        : tone.text
  const supported = caps ? Object.entries(caps.supported).map(([k, v]) => `${v ? '✓' : '✗'} ${k}`).join('\n') : ''
  const memPct = metrics && metrics.mem.total > 0 ? Math.round((metrics.mem.used / metrics.mem.total) * 100) : null

  return (
    <footer className="statusbar" aria-label="Status bar">
      <ServerMenu
        button={({ open, toggle, ref }) => (
          <button
            ref={ref}
            type="button"
            className="sb-item"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Server: ${who}, ${status.state === 'connected' ? 'connected' : tone.text.toLowerCase()}`}
            onClick={toggle}
            title={[who, saved ? serverAddress(saved) : '', status.hermesVersion ? `hermes v${status.hermesVersion}` : '', `${online} agents online`, supported].filter(Boolean).join('\n')}
            style={{ background: tone.bg, color: '#F8F8F2' }}
          >
            <Icon name="server" size={12} />
            {who}
          </button>
        )}
      />
      <span className="sb-item" style={{ cursor: 'default' }}>{detail}</span>
      {status.hermesVersion && <span className="sb-item" style={{ cursor: 'default' }}>hermes v{status.hermesVersion}</span>}
      <span className="sb-item" style={{ cursor: 'default' }}>{online} agent{online === 1 ? '' : 's'} online</span>
      <span className="sp" />
      <span className="sb-item" style={{ cursor: 'default' }} title="CPU"><Icon name="cpu" size={12} />{metrics ? `${Math.round(metrics.cpu.total)}%` : '–'}</span>
      <span className="sb-item" style={{ cursor: 'default' }} title="Memory"><Icon name="memory" size={12} />{memPct !== null ? `${memPct}%` : '–'}</span>
      <span style={{ display: 'inline-flex', alignItems: 'stretch' }}>
        <button type="button" className="sb-item" onClick={() => void stepZoomLevel(-1)} aria-label="Smaller text" title="Smaller text (Ctrl −)" style={{ padding: '0 6px' }}>
          <Icon name="minus" size={12} />
        </button>
        <button type="button" className="sb-item num" onClick={() => void setZoomLevel(1)} aria-label="Reset text size" title="Reset text size" style={{ padding: '0 2px', minWidth: 34, justifyContent: 'center' }}>
          {zoomPercent(zoom)}
        </button>
        <button type="button" className="sb-item" onClick={() => void stepZoomLevel(1)} aria-label="Larger text" title="Larger text (Ctrl +)" style={{ padding: '0 6px' }}>
          <Icon name="plus" size={12} />
        </button>
      </span>
      {update?.phase === 'ready' && (
        <button type="button" className="sb-item up-ready" onClick={() => void window.mc.update.install()} title={`Install v${update.version ?? ''} and restart`}>
          <Icon name="download" size={12} />
          Restart to update
        </button>
      )}
      <NoticeBell />
      <button type="button" className="sb-item" onClick={() => openSettings('general')} aria-label="Settings" title="Settings">
        <Icon name="settings" size={13} />
      </button>
    </footer>
  )
}
