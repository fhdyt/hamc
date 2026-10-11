import { useMemo, useState } from 'react'
import { Bar } from '../components/Bar'
import { Icon } from '../components/Icon'
import { Panel } from '../components/Panel'
import { EmptyState, Skeleton, StaleBanner } from '../components/States'
import { UplotChart } from '../components/UplotChart'
import { useNow } from '../hooks/useNow'
import { formatBytes, formatPct, formatRate, formatUptime, loadColor, textBar } from '../lib/format'
import { ariaSort, sortProcs, type SortKey } from '../lib/procs'
import { padLeft } from '../lib/window'
import { useConn } from '../stores/conn'
import { useMetrics } from '../stores/metrics'

export function Server() {
  const m = useMetrics((s) => s.latest)
  const receivedAt = useMetrics((s) => s.receivedAt)
  const cpuHist = useMetrics((s) => s.cpu)
  const rxHist = useMetrics((s) => s.rx)
  const txHist = useMetrics((s) => s.tx)
  const connState = useConn((s) => s.status.state)
  const now = useNow()
  const [hermesOnly, setHermesOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('cpu')
  const procs = useMemo(() => (m ? sortProcs(m.procs, sort, hermesOnly) : []), [m, sort, hermesOnly])
  const cpuSeries = useMemo(() => [padLeft(cpuHist)], [cpuHist])
  const rxSeries = useMemo(() => [padLeft(rxHist)], [rxHist])
  const txSeries = useMemo(() => [padLeft(txHist)], [txHist])

  if (!m) {
    return (
      <div className="page">
        <h1 className="page-title">Server</h1>
        {connState === 'connected' || connState === 'connecting' ? (
          <Skeleton rows={8} />
        ) : (
          <EmptyState title="No server data yet" why="Metrics stream in once Mission Control is connected to your VPS." />
        )}
      </div>
    )
  }

  const net = m.net[0]
  const memPct = m.mem.total ? (m.mem.used / m.mem.total) * 100 : 0
  const memRows = [
    { label: 'used', value: m.mem.used, color: '#50FA7B' },
    { label: 'cached', value: m.mem.cached, color: '#8BE9FD' },
    { label: 'available', value: m.mem.available, color: '#A9B2D3' },
    { label: 'free', value: m.mem.free, color: '#6272A4' }
  ]
  const th = (key: SortKey, label: string, right = false) => (
    <th scope="col" className={right ? 'r' : ''} aria-sort={ariaSort(sort, key)}>
      <button type="button" onClick={() => setSort(key)}>{label}{sort === key ? (key === 'pid' ? ' ▲' : ' ▼') : ''}</button>
    </th>
  )

  return (
    <div className="page">
      {connState !== 'connected' && receivedAt !== null && <StaleBanner receivedAt={receivedAt} now={now} label={connState === 'reconnecting' ? 'Reconnecting' : 'Offline'} />}
      <div className="srv-grid">
        <Panel title={`cpu ├─ ${formatPct(m.cpu.total)} ─ load ${m.cpu.load.map((l) => l.toFixed(2)).join(' ')} ─ up ${formatUptime(m.cpu.uptimeS)}${m.cpu.tempC !== null ? ` ─ ${Math.round(m.cpu.tempC)}°C` : ''}`} tone="hi" label="CPU" className="full">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ flex: '999 1 420px', minWidth: 0 }}>
              <UplotChart series={cpuSeries} colors={[loadColor(m.cpu.total)]} height={150} max={100} label="CPU usage over the last 60 seconds" />
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8B95BD', fontSize: 11 }}><span>-60s</span><span>-30s</span><span>now</span></div>
            </div>
            <div style={{ flex: '1 1 240px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '3px 16px', alignContent: 'start' }}>
              {m.cpu.cores.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#A9B2D3' }}>C{i}</span>
                  <span className="mono-bar" style={{ color: loadColor(c) }}>{textBar(c, 10)}</span>
                  <span style={{ marginLeft: 'auto' }}>{formatPct(c)}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title={`mem ├─ ${formatBytes(m.mem.total)}`} label="Memory">
          {memRows.map((r) => (
            <div key={r.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#A9B2D3' }}>{r.label}</span><span>{formatBytes(r.value)}</span></div>
              <Bar pct={m.mem.total ? (r.value / m.mem.total) * 100 : 0} color={r.color} />
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#A9B2D3' }}>swap</span><span>{formatBytes(m.mem.swapUsed)} / {formatBytes(m.mem.swapTotal)}</span></div>
            <Bar pct={m.mem.swapTotal ? (m.mem.swapUsed / m.mem.swapTotal) * 100 : 0} color="#FFB86C" />
          </div>
          <span className="vh">{formatPct(memPct)} of memory in use</span>
        </Panel>

        <Panel title={`net ├─ ${net?.name ?? 'no interface'}`} label="Network">
          {net ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8BE9FD' }}>rx {formatRate(net.rxBps)}</span><span style={{ color: '#A9B2D3' }}>total {formatBytes(net.rxTotal)}</span></div>
              <UplotChart series={rxSeries} colors={['#8BE9FD']} height={56} label="Download rate, last 60 seconds" />
              <UplotChart series={txSeries} colors={['#FF79C6']} height={56} label="Upload rate, last 60 seconds" />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#FF79C6' }}>tx {formatRate(net.txBps)}</span><span style={{ color: '#A9B2D3' }}>total {formatBytes(net.txTotal)}</span></div>
            </>
          ) : (
            <EmptyState title="No network interface" why="Only the loopback interface was found." />
          )}
        </Panel>

        <Panel title={`disks ├─ io r ${formatRate(m.io.readBps)} · w ${formatRate(m.io.writeBps)}`} label="Disks">
          {m.disks.length === 0 && <EmptyState title="No disks found" />}
          {m.disks.map((d) => {
            const pct = d.total ? (d.used / d.total) * 100 : 0
            return (
              <div key={d.mount} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{d.mount}</span><span style={{ color: '#A9B2D3' }}>{formatBytes(d.used)} / {formatBytes(d.total)} · {formatPct(pct)}</span></div>
                <div className="mono-bar" style={{ color: loadColor(pct) }} aria-hidden="true">{textBar(pct, 34)}</div>
              </div>
            )
          })}
        </Panel>

        <Panel title={`proc ├─ ${m.tasks} tasks`} label="Processes" className="full flush">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 14px', alignItems: 'center' }}>
            <button type="button" className="cb" aria-pressed={hermesOnly} onClick={() => setHermesOnly((v) => !v)} style={hermesOnly ? { background: '#50FA7B', color: '#282A36' } : { color: '#50FA7B' }}>
              <Icon name="filter" size={12} /> Hermes only
            </button>
            <span style={{ color: '#8B95BD', marginLeft: 'auto' }}>read-only · no kill/renice</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  {th('pid', 'PID')}
                  <th scope="col">USER</th>
                  {th('cpu', 'CPU%', true)}
                  {th('mem', 'MEM%', true)}
                  <th scope="col" className="r">RSS</th>
                  <th scope="col">COMMAND</th>
                </tr>
              </thead>
              <tbody>
                {procs.map((p) => (
                  <tr key={p.pid} className={p.hermes ? 'hm' : ''}>
                    <td style={{ color: '#A9B2D3' }}>{p.pid}</td>
                    <td>{p.user}</td>
                    <td className="r" style={{ color: loadColor(p.cpu * 3) }}>{p.cpu.toFixed(1)}</td>
                    <td className="r">{p.mem.toFixed(1)}</td>
                    <td className="r">{formatBytes(p.rss, 0)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.cmd}</td>
                  </tr>
                ))}
                {procs.length === 0 && (
                  <tr><td colSpan={6}><EmptyState title="No matching processes" why="No Hermes process is running right now." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
