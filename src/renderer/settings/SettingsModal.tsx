import { useEffect, useState, type ReactNode } from 'react'
import type { AppInfo } from '@shared/ipc'
import { saveSetting, setZoomLevel, stepZoomLevel } from '../actions'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { UnsupportedState } from '../components/States'
import { zoomPercent } from '../lib/zoom'
import { EditConnectionDialogBody } from '../screens/EditConnectionDialog'
import { useUi, type SettingsTab } from '../stores/ui'
import { UploadsTab } from './UploadsTab'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'connection', label: 'Connection' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'uploads', label: 'Uploads' },
  { id: 'data', label: 'Data' },
  { id: 'about', label: 'About' }
]

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="sw" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 40 }}>
      <div style={{ flex: 1 }}>
        <div>{label}</div>
        {hint && <div style={{ color: '#8B95BD', fontSize: 11 }}>{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function General() {
  const s = useUi((st) => st.settings)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Row label="Text size" hint="Ctrl + / Ctrl −, 70% to 150%">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button type="button" className="ib" aria-label="Smaller text" onClick={() => void stepZoomLevel(-1)}><Icon name="minus" size={12} /></button>
          <button type="button" className="cb" aria-label="Reset text size" onClick={() => void setZoomLevel(1)} style={{ minWidth: 56 }}>{zoomPercent(s['ui.zoom'])}</button>
          <button type="button" className="ib" aria-label="Larger text" onClick={() => void stepZoomLevel(1)}><Icon name="plus" size={12} /></button>
        </span>
      </Row>
      <Row label="Density" hint="Compact is 12 px, comfortable is 13 px">
        <span className="seg" role="group" aria-label="Density">
          {(['compact', 'comfortable'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={s['ui.density'] === d} onClick={() => void saveSetting('ui.density', d)}>{d}</button>
          ))}
        </span>
      </Row>
      <Row label="Reduce motion" hint="Turns off animations">
        <Switch checked={s['ui.reduceMotion']} label="Reduce motion" onChange={(v) => void saveSetting('ui.reduceMotion', v)} />
      </Row>
    </div>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.mc.app.info().then(setInfo)
  }, [])
  return (
    <dl className="kv" style={{ margin: 0 }}>
      <dt>app</dt><dd>Hermes Agent Mission Control {info ? `v${info.version}` : ''}</dd>
      <dt>electron</dt><dd>{info?.electron ?? '–'}</dd>
      <dt>platform</dt><dd>{info?.platform ?? '–'}</dd>
    </dl>
  )
}

export function SettingsModal() {
  const tab = useUi((s) => s.settingsTab)
  const openSettings = useUi((s) => s.openSettings)
  const close = useUi((s) => s.closeSettings)
  if (!tab) return null
  return (
    <Modal title="Settings" onClose={close} width={760}>
      <div style={{ display: 'flex', gap: 16, minHeight: 320 }}>
        <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" style={{ flex: 'none', width: 150, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="settings-panel"
              className="set-tab"
              style={tab === t.id ? { background: '#343746', color: '#50FA7B', fontWeight: 600 } : undefined}
              onClick={() => openSettings(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="settings-panel" aria-labelledby={`tab-${tab}`} style={{ flex: 1, minWidth: 0 }}>
          {tab === 'general' && <General />}
          {tab === 'connection' && <EditConnectionDialogBody onDone={close} />}
          {tab === 'about' && <About />}
          {tab === 'uploads' && <UploadsTab />}
          {tab !== 'general' && tab !== 'connection' && tab !== 'about' && tab !== 'uploads' && <UnsupportedState why="This section arrives in a later release." />}
        </div>
      </div>
    </Modal>
  )
}
