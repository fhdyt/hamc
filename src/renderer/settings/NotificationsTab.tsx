import { useState } from 'react'
import { HHMM_RE, inQuietHours, type NotifyKinds } from '@shared/notify'
import { saveSetting } from '../actions'
import { useUi } from '../stores/ui'
import { Row, Switch } from './parts'

const KINDS: { key: keyof NotifyKinds; label: string; hint: string }[] = [
  { key: 'chat', label: 'Agent replies', hint: 'A reply finished while that agent was not on screen' },
  { key: 'cron', label: 'Failed cron runs', hint: 'A scheduled job failed (after the first check of each connection)' },
  { key: 'gateway', label: 'Gateway and platform problems', hint: 'A gateway stopped or a platform failed (rule in Alerts)' },
  { key: 'cost', label: 'Daily cost', hint: 'All agents together passed the daily amount set in Alerts' }
]

/** Settings → Notifications (F-SHELL-4, F-R13-4). */
export function NotificationsTab() {
  const s = useUi((st) => st.settings)
  const kinds = s['notify.kinds']
  const quiet = s['notify.quiet']
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [from, setFrom] = useState(quiet.from)
  const [to, setTo] = useState(quiet.to)
  const now = new Date()
  const quietNow = inQuietHours(quiet, now.getHours() * 60 + now.getMinutes())
  const saveTime = (which: 'from' | 'to', v: string): void => {
    if (which === 'from') setFrom(v)
    else setTo(v)
    if (HHMM_RE.test(v)) void saveSetting('notify.quiet', { ...quiet, [which]: v })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Row label="Show desktop notifications over other apps" hint="When Mission Control is minimized, behind other windows or in the tray, the system shows them. In front, a toast in the corner is enough.">
        <Switch checked={s['notify.desktop']} label="Show desktop notifications over other apps" onChange={(v) => void saveSetting('notify.desktop', v)} />
      </Row>
      <div role="group" aria-label="What to notify" style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 12, borderLeft: '2px solid #44475A' }}>
        {KINDS.map((k) => (
          <Row key={k.key} label={k.label} hint={k.hint}>
            <Switch checked={kinds[k.key]} label={k.label} onChange={(v) => void saveSetting('notify.kinds', { ...kinds, [k.key]: v })} />
          </Row>
        ))}
      </div>
      <Row label="Show message preview" hint="Off: a reply notification only names the agent">
        <Switch checked={s['notify.preview']} label="Show message preview" onChange={(v) => void saveSetting('notify.preview', v)} />
      </Row>
      <Row label="Sound" hint="The system's notification sound">
        <Switch checked={s['notify.sound']} label="Sound" onChange={(v) => void saveSetting('notify.sound', v)} />
      </Row>
      <Row label="Do not disturb" hint={`No desktop notifications or sounds in these hours (this computer's clock); the bell still keeps them.${quietNow ? ' Quiet right now.' : ''}`}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input className="fld" type="time" aria-label="Quiet from" value={from} disabled={!quiet.enabled} onChange={(e) => saveTime('from', e.target.value)} style={{ width: 124, colorScheme: 'dark' }} />
          <span style={{ color: '#8B95BD' }}>to</span>
          <input className="fld" type="time" aria-label="Quiet until" value={to} disabled={!quiet.enabled} onChange={(e) => saveTime('to', e.target.value)} style={{ width: 124, colorScheme: 'dark' }} />
          <Switch checked={quiet.enabled} label="Do not disturb" onChange={(v) => void saveSetting('notify.quiet', { ...quiet, enabled: v })} />
        </span>
      </Row>
      <Row label="Test" hint="Shows one notification now, even with the window in front">
        <button
          type="button"
          className="cb"
          onClick={() =>
            void window.mc.notify.test().then((r) => setTest(r.shown ? { ok: true, text: 'Sent. If nothing appeared, check the notification settings of your system.' } : { ok: false, text: r.reason ?? 'Not shown.' }))
          }
        >
          Send a test notification
        </button>
      </Row>
      {test && (
        <div className={`banner ${test.ok ? 'ok' : 'bad'}`} role={test.ok ? 'status' : 'alert'}>
          {test.text}
        </div>
      )}
    </div>
  )
}
