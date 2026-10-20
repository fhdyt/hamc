import type { SavedConnection } from '@shared/ipc'
import { trustAndRetry } from '../actions'
import { useConn } from '../stores/conn'
import { ConnectionForm } from './connect/ConnectionForm'
import { HostKeyPanel } from './connect/HostKeyPanel'

/** The form of one saved server (or of a new one when `server` is null), with the host key prompt of the last attempt. */
export function EditConnectionDialogBody({ server, onDone }: { server: SavedConnection | null; onDone: () => void }) {
  const hostKey = useConn((s) => s.hostKey)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ConnectionForm key={server?.id ?? 'new'} mode={server ? 'edit' : 'add'} server={server} onConnected={onDone} />
      {hostKey && (
        <HostKeyPanel
          onTrust={() => void trustAndRetry().then((r) => r?.ok && onDone())}
          onCancel={() => useConn.setState({ hostKey: null })}
        />
      )}
      {server?.fingerprint && (
        <div style={{ color: '#A9B2D3', fontSize: 12 }}>
          Trusted host key: <code style={{ color: '#F8F8F2', overflowWrap: 'anywhere' }}>{server.fingerprint}</code>
        </div>
      )}
    </div>
  )
}
