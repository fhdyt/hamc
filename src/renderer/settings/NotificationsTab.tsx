import { useState } from 'react'
import { HHMM_RE, REPLY_TONES, inQuietHours, type NotifyKinds, type ReplySoundMode } from '@shared/notify'
import { saveSetting } from '../actions'
import { Icon } from '../components/Icon'
import { TONE_LABEL } from '../lib/sound'
import { previewTone } from '../soundActions'
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
      <Row label="Reply sound" hint="A short sound when an agent's reply arrives. When away: only when that agent is not on screen. Never in the quiet hours.">
        <span className="seg" role="group" aria-label="Reply sound">
          {(['off', 'away', 'always'] as ReplySoundMode[]).map((m) => (
            <button key={m} type="button" aria-pressed={s['notify.replySound'] === m} onClick={() => void saveSetting('notify.replySound', m)}>
              {m === 'off' ? 'Off' : m === 'away' ? 'When away' : 'Always'}
            </button>
          ))}
        </span>
      </Row>
      {s['notify.replySound'] !== 'off' && (
        <div role="group" aria-label="Reply sound tone" style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 12, borderLeft: '2px solid #44475A', minHeight: 36, flexWrap: 'wrap' }}>
          <span className="seg" role="group" aria-label="Tone">
            {REPLY_TONES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={s['notify.replyTone'] === t}
                onClick={() => {
                  void saveSetting('notify.replyTone', t)
                  previewTone(t, s['notify.volume'])
                }}
              >
                {TONE_LABEL[t]}
              </button>
            ))}
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#A9B2D3' }}>
            Volume
            <input
              type="range"
              aria-label="Reply sound volume"
              min={0}
              max={100}
              step={5}
              value={Math.round(s['notify.volume'] * 100)}
              onChange={(e) => void saveSetting('notify.volume', Number(e.target.value) / 100)}
              onPointerUp={() => previewTone(s['notify.replyTone'], s['notify.volume'])}
              style={{ width: 120 }}
            />
            <span className="num" style={{ minWidth: 34 }}>{Math.round(s['notify.volume'] * 100)}%</span>
          </label>
          <button type="button" className="cb sm" onClick={() => previewTone(s['notify.replyTone'], s['notify.volume'])}>
            <Icon name="play" size={11} /> Play
          </button>
        </div>
      )}
      <Row label="System sound" hint="The sound of the OS notifications (a reply uses the reply sound above instead)">
        <Switch checked={s['notify.sound']} label="System sound" onChange={(v) => void saveSetting('notify.sound', v)} />
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
