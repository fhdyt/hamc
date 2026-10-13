import { useMemo, useState } from 'react'
import { gatewayCommandPreview, type GatewayAction } from '@shared/logs'
import { Modal } from '../../components/Modal'
import { EmptyState } from '../../components/States'
import { formatAge } from '../../lib/format'
import { buildGatewayRows, type GatewayRow } from '../../lib/gatewayView'
import { sortAgents } from '../../lib/roster'
import { runGatewayAction } from '../../logsActions'
import { useAgents } from '../../stores/agents'

const TITLE: Record<GatewayAction, string> = { restart: 'Restart gateway', stop: 'Stop gateway' }

function ConfirmDialog({ row, action, onClose, onDone }: { row: GatewayRow; action: GatewayAction; onClose: () => void; onDone: (text: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await runGatewayAction(action, row.profile)
    setBusy(false)
    if (res.ok) {
      onDone(`${action === 'restart' ? 'Restarted' : 'Stopped'} the gateway of ${row.name}.${res.output ? ` ${res.output}` : ''}`)
      onClose()
    } else setError(res.error === 'not-connected' ? 'Not connected to the server.' : res.error === 'bad-input' ? 'Hermes cannot take that request.' : (res.detail ?? 'The command failed.'))
  }

  return (
    <Modal title={TITLE[action]} onClose={onClose} width={520}>
      <div className="ses-dlg">
        <p className="ses-dlg-text">
          {action === 'restart'
            ? `Restarting waits for a turn that is running to finish. ${row.name} answers again once its gateway is back.`
            : `${row.name} stays offline until its gateway is started again from a terminal or systemd. Mission Control has no Start button on purpose.`}
        </p>
        {action === 'stop' && <p className="ses-dlg-text">A chat turn that is running for {row.name} ends.</p>}
        <span className="ses-dlg-lbl">This runs on the server:</span>
        <pre className="ses-dlg-cmd">{gatewayCommandPreview(action, row.profile)}</pre>
        {error && (
          <div className="banner bad" role="alert">
            {error}
          </div>
        )}
        <div className="ses-dlg-actions">
          <button type="button" className="cb" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`cb ${action === 'stop' ? 'dng' : 'pri'}`} disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Working…' : TITLE[action]}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function GatewayTab() {
  const agents = useAgents((s) => s.agents)
  const rows = useMemo(() => buildGatewayRows(sortAgents(agents)), [agents])
  const [ask, setAsk] = useState<{ row: GatewayRow; action: GatewayAction } | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (rows.length === 0) return <EmptyState title="No agents yet" why="Agents appear after the first successful connection." />

  return (
    <div className="lg-gw">
      {done && (
        <div className="banner ok" role="status">
          {done}
        </div>
      )}
      {rows.map((r) => (
        <section key={r.profile} className="lg-gw-card" aria-label={`Gateway of ${r.name}`}>
          <div className="lg-gw-head">
            <h2>{r.name}</h2>
            <span className="lg-tone" data-tone={r.tone}>
              {r.state}
            </span>
            {r.ageS !== null && (
              <span className="lg-meta">
                heartbeat {formatAge(r.ageS)}
                {r.stale ? ' · stale' : ''}
              </span>
            )}
            {r.pid !== 'unknown' && <span className="lg-meta">process {r.pid === 'alive' ? 'running' : 'gone'}</span>}
            {r.exitReason && <span className="lg-meta">exit: {r.exitReason}</span>}
            <span className="lg-actions">
              <button type="button" className="cb sm" aria-label={`Restart gateway of ${r.name}`} disabled={r.tone === 'off'} onClick={() => setAsk({ row: r, action: 'restart' })}>
                Restart
              </button>
              <button type="button" className="cb sm dng" aria-label={`Stop gateway of ${r.name}`} disabled={r.tone === 'off'} onClick={() => setAsk({ row: r, action: 'stop' })}>
                Stop
              </button>
            </span>
          </div>
          {r.platforms.length > 0 && (
            <div className="lg-plats" role="list" aria-label={`Platforms of ${r.name}`}>
              {r.platforms.map((p) => (
                <span key={p.name} role="listitem" className="lg-plat" data-problem={p.problem}>
                  {p.name} {'·'} {p.label}
                </span>
              ))}
            </div>
          )}
        </section>
      ))}
      <p className="lg-note">Start is not offered: start a gateway from a terminal or systemd. Platform states come from each agent's gateway_state.json; fields Mission Control does not know are left out.</p>
      {ask && <ConfirmDialog row={ask.row} action={ask.action} onClose={() => setAsk(null)} onDone={setDone} />}
    </div>
  )
}
