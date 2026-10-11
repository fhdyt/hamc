import { useMemo } from 'react'
import { Bar } from '../../components/Bar'
import { Panel } from '../../components/Panel'
import { Skeleton } from '../../components/States'
import { UplotChart } from '../../components/UplotChart'
import { formatPct, formatRate, loadColor } from '../../lib/format'
import { padLeft } from '../../lib/window'
import { useConn } from '../../stores/conn'
import { useMetrics } from '../../stores/metrics'
import { useUi } from '../../stores/ui'

export function ServerStrip() {
  const m = useMetrics((s) => s.latest)
  const cpuHist = useMetrics((s) => s.cpu)
  const connState = useConn((s) => s.status.state)
  const navigate = useUi((s) => s.navigate)
  const series = useMemo(() => [padLeft(cpuHist)], [cpuHist])

  if (!m) {
    return (
      <Panel title="server" tone="hi">
        {connState === 'connected' || connState === 'connecting' ? <Skeleton rows={3} /> : <span style={{ color: '#8B95BD' }}>No server data yet.</span>}
      </Panel>
    )
  }
  const mem = m.mem.total ? (m.mem.used / m.mem.total) * 100 : 0
  const root = m.disks.find((d) => d.mount === '/') ?? m.disks[0]
  const disk = root && root.total ? (root.used / root.total) * 100 : 0
  const net = m.net[0]
  return (
    <Panel title={`server ├─ cpu ${formatPct(m.cpu.total)} ─ mem ${formatPct(mem)}`} tone="hi" label="Server summary">
      <button type="button" onClick={() => navigate('server')} aria-label="Open server details" style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <UplotChart series={series} colors={[loadColor(m.cpu.total)]} height={56} max={100} label="CPU usage over the last 60 seconds" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <div><div style={{ color: '#A9B2D3' }}>memory {formatPct(mem)}</div><Bar pct={mem} color={loadColor(mem)} /></div>
          <div><div style={{ color: '#A9B2D3' }}>disk {root?.mount ?? '–'} {formatPct(disk)}</div><Bar pct={disk} color={loadColor(disk)} /></div>
          <div style={{ color: '#A9B2D3' }}>net <span style={{ color: '#8BE9FD' }}>↓ {formatRate(net?.rxBps ?? 0)}</span> <span style={{ color: '#FF79C6' }}>↑ {formatRate(net?.txBps ?? 0)}</span></div>
        </div>
      </button>
    </Panel>
  )
}
