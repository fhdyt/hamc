import { useEffect, useState, type ReactNode } from 'react'
import type { AppInfo } from '@shared/ipc'
import { resetSettings, saveSetting, setZoomLevel, stepZoomLevel } from '../actions'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { UnsupportedState } from '../components/States'
import { zoomPercent } from '../lib/zoom'
import { EditConnectionDialogBody } from '../screens/EditConnectionDialog'
import { AgentsSettings } from '../screens/agents/AgentsSettings'
import { UnsavedDialog } from '../screens/agents/Dialogs'
import { useAgentCfg } from '../stores/agentCfg'
import { useUi, type SettingsTab } from '../stores/ui'
import { AlertsTab } from './AlertsTab'
import { UploadsTab } from './UploadsTab'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'connection', label: 'Connection' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'chat', label: 'Chat' },
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
  const [confirmReset, setConfirmReset] = useState(false)
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
      <Row label="Reset settings" hint="Text size, density, panel sizes, graph choices and filters go back to their defaults. Your connection, pinned agents, vault path and the window size stay.">
        {confirmReset ? (
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button type="button" className="cb dng" onClick={() => void resetSettings().then(() => setConfirmReset(false))}>Reset all settings</button>
            <button type="button" className="cb" onClick={() => setConfirmReset(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="cb" onClick={() => setConfirmReset(true)}>Reset settings…</button>
        )}
      </Row>
    </div>
  )
}

function ChatSettings() {
  const on = useUi((st) => st.settings['chat.useAcp'])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Row label="Ask before risky actions" hint="Chats through hermes acp when the server has it. Hermes then asks you in the chat before it runs something its policy does not allow by itself, like Telegram does. Without it, such actions are refused.">
        <Switch checked={on} label="Ask before risky actions" onChange={(v) => void saveSetting('chat.useAcp', v)} />
      </Row>
      <div style={{ color: '#8B95BD', fontSize: 11 }}>Mission Control never turns approvals off and never adds --yolo. Your answer is only for the action Hermes asks about.</div>
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
  const closeNow = useUi((s) => s.closeSettings)
  const requestLeave = useAgentCfg((s) => s.requestLeave)
  const anyUnsaved = useAgentCfg((s) => Object.values(s.drafts).some((d) => d.loaded && d.text !== d.baseText) || Object.values(s.modelDirty).some(Boolean))

  // F-CFG-18: a window that holds unsaved edits asks before it closes (the main process shows the dialog).
  useEffect(() => {
    if (!anyUnsaved) return
    const guard = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [anyUnsaved])

  if (!tab) return <UnsavedDialog />
  const close = (): void => requestLeave('Closing Settings drops every unsaved change in Agents.', closeNow)
  return (
    <>
    <Modal title="Settings" onClose={close} width={tab === 'agents' ? 1000 : 760}>
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
          {tab === 'chat' && <ChatSettings />}
          {tab === 'uploads' && <UploadsTab />}
          {tab === 'agents' && <AgentsSettings />}
          {tab === 'alerts' && <AlertsTab />}
          {tab !== 'general' && tab !== 'connection' && tab !== 'about' && tab !== 'uploads' && tab !== 'chat' && tab !== 'agents' && tab !== 'alerts' && <UnsupportedState why="This section arrives in a later release." />}
        </div>
      </div>
    </Modal>
    <UnsavedDialog />
    </>
  )
}
