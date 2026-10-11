import { useConn } from '../../stores/conn'

const COLOR = { ok: '#50FA7B', warn: '#FFB86C', fail: '#FF5555', info: '#8BE9FD' } as const

export function PreflightPanel() {
  const pre = useConn((s) => s.preflight)
  const connecting = useConn((s) => s.connecting)
  if (!pre) {
    return (
      <section className="pnl" aria-label="Preflight">
        <h2 className="pt">┤ preflight ├</h2>
        <div style={{ color: '#8B95BD' }}>{connecting ? 'Running checks…' : 'Checks appear here once you connect.'}</div>
      </section>
    )
  }
  const bad = pre.items.filter((i) => i.state === 'fail').length
  const passed = pre.items.filter((i) => i.state === 'ok' || i.state === 'info').length
  return (
    <section className="pnl" aria-label="Preflight">
      <h2 className="pt">┤ preflight ├</h2>
      {pre.items.map((i) => (
        <div key={i.id}>
          <div className="preflight-row">
            <span style={{ color: '#8B95BD' }}>&gt;</span>
            <span>{i.label}</span>
            <span className="dots" aria-hidden="true">..............................................................</span>
            <span style={{ color: COLOR[i.state] }}>{i.result}</span>
          </div>
          {i.hint && i.state !== 'ok' && <p className="hint-line">{i.hint}</p>}
        </div>
      ))}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #44475A', color: bad === 0 ? '#50FA7B' : '#FF5555' }}>
        {bad === 0
          ? `${passed}/${pre.items.length} checks passed, opening console_`
          : `${bad} check${bad === 1 ? '' : 's'} failed. Features that do not depend on them keep working.`}
      </div>
    </section>
  )
}
