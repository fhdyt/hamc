import { useState } from 'react'
import { forgetConnection, trustAndRetry } from '../actions'
import { Modal } from '../components/Modal'
import { useConn } from '../stores/conn'
import { ConnectionForm } from './connect/ConnectionForm'
import { HostKeyPanel } from './connect/HostKeyPanel'

export function EditConnectionDialogBody({ onDone }: { onDone: () => void }) {
  const saved = useConn((s) => s.saved)
  const hostKey = useConn((s) => s.hostKey)
  const [confirmForget, setConfirmForget] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ConnectionForm mode="edit" onConnected={onDone} />
      {hostKey && (
        <HostKeyPanel
          onTrust={() => void trustAndRetry().then((r) => r?.ok && onDone())}
          onCancel={() => useConn.setState({ hostKey: null })}
        />
      )}
      {saved?.fingerprint && (
        <div style={{ color: '#A9B2D3', fontSize: 12 }}>
          Trusted host key: <code style={{ color: '#F8F8F2', overflowWrap: 'anywhere' }}>{saved.fingerprint}</code>
        </div>
      )}
      <div style={{ borderTop: '1px solid #44475A', paddingTop: 12 }}>
        {confirmForget ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ color: '#FFB86C' }}>
              This removes the saved connection, its password or key passphrase and its trusted host key from this computer. The key file itself stays where it is. Nothing changes on your VPS.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="cb dng" onClick={() => void forgetConnection()}>Forget this connection</button>
              <button type="button" className="cb" onClick={() => setConfirmForget(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="cb dng" onClick={() => setConfirmForget(true)}>Forget this connection…</button>
        )}
      </div>
    </div>
  )
}

export function EditConnectionDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Edit connection" onClose={onClose} width={560}>
      <EditConnectionDialogBody onDone={onClose} />
    </Modal>
  )
}
