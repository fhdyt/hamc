import { saveSetting } from '../../actions'
import { Icon } from '../../components/Icon'
import { Panel } from '../../components/Panel'
import { Skeleton } from '../../components/States'
import { formatBytes, formatPct, formatRate, formatUptime, loadColor } from '../../lib/format'
import { padLeft } from '../../lib/window'
import { useConn } from '../../stores/conn'
import { useMetrics } from '../../stores/metrics'
import { useUi } from '../../stores/ui'

const CPU_BARS = 48
const NET_BARS = 30

function Bars({ values, color, height, max }: { values: number[]; color: (v: number) => string; height: number; max: number }) {
  return (
    <div className="d-bars" style={{ height }} aria-hidden="true">
      {values.map((v, i) => (
        <i key={i} style={{ height: Math.max(1, Math.round((Math.min(v, max) / (max || 1)) * height)), background: color(v), opacity: 0.45 + 0.55 * (i / values.length) }} />
      ))}
    </div>
  )
}

function Meter({ label, value, pct, sub }: { label: string; value: string; pct: number; sub: string }) {
  return (
    <div className="d-meter">
      <div className="d-meter-top">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="d-meter-bar" role="img" aria-label={`${label} ${formatPct(pct)}`}>
        <i style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: loadColor(pct) }} />
      </div>
      <span className="d-meter-sub">{sub}</span>
    </div>
  )
}

const gib = (n: number): string => formatBytes(n, 1).replace(' GiB', 'G').replace(' MiB', 'M').replace(' TiB', 'T').replace(' KiB', 'K')

/** The server summary of the Dashboard: CPU history, memory, disks, network and the busiest processes. */
export function ServerPanel() {
  const m = useMetrics((s) => s.latest)
  const cpuHist = useMetrics((s) => s.cpu)
  const rxHist = useMetrics((s) => s.rx)
  const open = useUi((s) => s.settings['dashboard.serverOpen'])
  const navigate = useUi((s) => s.navigate)
  const connState = useConn((s) => s.status.state)

  const toggle = (
    <>
      <button type="button" className="ib sm" onClick={() => navigate('server')} aria-label="Open server" title="Open server">
        <Icon name="external" size={13} />
      </button>
      <button type="button" className="ib sm" aria-expanded={open} aria-label={open ? 'Hide server' : 'Show server'} title={open ? 'Hide' : 'Show'} onClick={() => void saveSetting('dashboard.serverOpen', !open)}>
        <Icon name={open ? 'chev-up' : 'chev-down'} size={14} />
      </button>
    </>
  )

  if (!m) {
    return (
      <Panel variant="card" title="server" label="Server" actions={toggle} className="d-server">
        {connState === 'connected' || connState === 'connecting' ? <Skeleton rows={3} /> : <span style={{ color: '#8B95BD' }}>No server data yet.</span>}
      </Panel>
    )
  }

  const mem = m.mem.total ? (m.mem.used / m.mem.total) * 100 : 0
  const root = m.disks.find((d) => d.mount === '/') ?? m.disks[0]
  const others = m.disks.filter((d) => d !== root).sort((a, b) => b.used / (b.total || 1) - a.used / (a.total || 1))
  const second = others[0]
  const disk = (d: typeof root): { pct: number; sub: string } => ({ pct: d && d.total ? (d.used / d.total) * 100 : 0, sub: d ? `${gib(d.used)} / ${gib(d.total)}` : '–' })
  const net = m.net[0]
  const top = [...m.procs].sort((a, b) => b.cpu - a.cpu).slice(0, 2)
  const cpuColor = loadColor(m.cpu.total)
  const cores = m.cpu.cores.length
  const meta = `${cores} vCPU · ${gib(m.mem.total)} · up ${formatUptime(m.cpu.uptimeS)} · load ${m.cpu.load.map((x) => x.toFixed(2)).join(' ')}`
  const rxMax = Math.max(1, ...rxHist)

  return (
    <Panel
      variant="card"
      title="server"
      label="Server"
      meta={open ? meta : undefined}
      actions={toggle}
      className="d-server"
      head={
        <>
          <h2>server</h2>
          {!open && (
            <span className="d-sum">
              <span>
                cpu <span style={{ color: cpuColor }}>{formatPct(m.cpu.total)}</span>
              </span>
              <span>
                mem <span style={{ color: loadColor(mem) }}>{formatPct(mem)}</span>
              </span>
              {root && (
                <span>
                  disk <span style={{ color: loadColor(disk(root).pct) }}>{formatPct(disk(root).pct)}</span>
                </span>
              )}
              <span>
                net <span style={{ color: '#8BE9FD' }}>↓ {formatRate(net?.rxBps ?? 0)}</span>
              </span>
            </span>
          )}
        </>
      }
    >
      {open && (
        <div className="d-metrics">
          <div className="d-cpu">
            <div className="d-meter-top">
              <span>cpu</span>
              <span className="num" style={{ color: cpuColor }}>
                {formatPct(m.cpu.total)}
              </span>
            </div>
            <Bars values={padLeft(cpuHist).slice(-CPU_BARS)} color={loadColor} height={36} max={100} />
          </div>
          <Meter label="mem" value={`${gib(m.mem.used)}/${gib(m.mem.total)}`} pct={mem} sub={`cache ${gib(m.mem.cached)} · swap ${gib(m.mem.swapUsed)}`} />
          <Meter label={`disk ${root?.mount ?? ''}`} value={formatPct(disk(root).pct)} pct={disk(root).pct} sub={disk(root).sub} />
          {second && <Meter label={second.mount} value={formatPct(disk(second).pct)} pct={disk(second).pct} sub={disk(second).sub} />}
          <div className="d-net">
            <div className="d-meter-top">
              <span>net</span>
              <span style={{ color: '#8BE9FD' }}>
                rx {formatRate(net?.rxBps ?? 0)} <span style={{ color: '#FF79C6' }}>tx {formatRate(net?.txBps ?? 0)}</span>
              </span>
            </div>
            <Bars values={padLeft(rxHist).slice(-NET_BARS)} color={() => '#8BE9FD'} height={18} max={rxMax} />
            {top.length > 0 && <span className="d-meter-sub">top: {top.map((p) => `${p.cmd.split(/[\s/]+/).filter(Boolean).pop()?.slice(0, 14) ?? p.cmd} ${p.cpu.toFixed(1)}%`).join(' · ')}</span>}
          </div>
        </div>
      )}
    </Panel>
  )
}
