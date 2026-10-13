import { useState } from 'react'
import { saveVault } from '../actions'
import { VaultSetup } from '../screens/brain/VaultSetup'
import { useBrain } from '../stores/brain'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'
import { Row } from './parts'

/** Settings → Workspace (F-SHELL-7, F-R10-2): the vault path lives here; Hermes paths are shown as found on the server. */
export function WorkspaceTab() {
  const vault = useBrain((s) => s.vault)
  const connected = useConn((s) => s.status.state === 'connected')
  const pre = useConn((s) => s.preflight)
  const s = useUi((st) => st.settings)
  const openSettings = useUi((st) => st.openSettings)
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <section aria-label="Second brain vault" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row label="Obsidian vault" hint="The folder of notes on the server that Second brain draws. It is read, never written.">
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {!editing && (
              <button type="button" className="cb" disabled={!connected} onClick={() => setEditing(true)}>
                {vault ? 'Change…' : 'Choose…'}
              </button>
            )}
            {vault && !editing && !confirmRemove && (
              <button type="button" className="cb" onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            )}
            {confirmRemove && (
              <>
                <button
                  type="button"
                  className="cb dng"
                  onClick={() =>
                    void saveVault(null).then(() => {
                      setConfirmRemove(false)
                    })
                  }
                >
                  Remove vault
                </button>
                <button type="button" className="cb" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </button>
              </>
            )}
          </span>
        </Row>
        <code className="ws-path" aria-label="Vault path">
          {vault ?? 'No vault chosen'}
        </code>
        {!connected && <span style={{ color: '#8B95BD', fontSize: 11 }}>Connect to choose or check a folder.</span>}
        {editing && <VaultSetup initial={vault ?? ''} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />}
      </section>
      <section aria-label="Hermes on the server" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ color: '#BD93F9', fontWeight: 600, marginTop: 6 }}>Hermes on the server</div>
        <span style={{ color: '#8B95BD', fontSize: 11 }}>Found when connecting (HERMES_HOME, then ~/.hermes). Read only.</span>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>home</dt>
          <dd>{pre?.hermesHome ?? '–'}</dd>
          <dt>hermes</dt>
          <dd>{pre?.hermesPath ?? '–'}</dd>
          <dt>python</dt>
          <dd>{pre?.pythonPath ?? '–'}</dd>
          <dt>version</dt>
          <dd>{pre?.version ?? '–'}</dd>
        </dl>
      </section>
      <section aria-label="Uploads" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Row label="Upload folder" hint={`${s['chat.uploadDir']} · up to ${s['chat.maxUploadMb']} MB per file`}>
          <button type="button" className="cb" onClick={() => openSettings('uploads')}>
            Uploads…
          </button>
        </Row>
      </section>
    </div>
  )
}
