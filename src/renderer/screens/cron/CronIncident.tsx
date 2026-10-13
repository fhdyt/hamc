import type { CronJob } from '@shared/events'
import { Icon } from '../../components/Icon'
import { askAction } from '../../cronActions'
import { formatLocal, jobKey } from '../../lib/cron'
import { ackBlock, actionsBlock, incidentHeadline, incidentTypeLabel } from '../../lib/cronControl'
import { useConn } from '../../stores/conn'
import { useCron } from '../../stores/cron'

/** The open incident of a job from the Hermes ledger, with Acknowledge (F-CRON-11). */
export function CronIncident({ job }: { job: CronJob }) {
  const inc = job.incident
  const connected = useConn((s) => s.status.state === 'connected')
  const supported = useConn((s) => s.capabilities?.supported['cron incidents'])
  const busy = useCron((s) => s.pending[jobKey(job)] !== undefined)
  if (!inc) return null
  const off = actionsBlock(connected) ?? ackBlock(supported)
  return (
    <div className="cc-inc" role="group" aria-label="Incident">
      <span className="cc-inc-head">
        <span className="cc-inc-icon" aria-hidden="true">
          <Icon name="alert" size={14} />
        </span>
        <span className="cc-inc-title">{incidentHeadline(job, inc)}</span>
        <span className="badge" style={{ color: '#FF5555', borderColor: '#FF5555' }}>
          {inc.state.toUpperCase()}
        </span>
      </span>
      <dl className="kv cc-inc-kv">
        <dt>type</dt>
        <dd>{incidentTypeLabel(inc.failureType)}</dd>
        <dt>first seen</dt>
        <dd>{formatLocal(inc.firstSeenTs)}</dd>
        <dt>last seen</dt>
        <dd>{formatLocal(inc.lastSeenTs)}</dd>
        <dt>id</dt>
        <dd>{inc.id}</dd>
      </dl>
      {inc.error && <pre className="cron-pre cc-inc-err">{inc.error}</pre>}
      <span className="cc-inc-foot">
        <span className="cc-why">It closes by itself after the next good run.</span>
        <button type="button" className="cb sm" disabled={off !== null || busy} title={off ?? undefined} onClick={() => askAction('ack')}>
          Acknowledge
        </button>
      </span>
      {off && connected && <span className="cc-why">{off}</span>}
    </div>
  )
}
