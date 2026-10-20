import { switchServer } from '../serverActions'
import { useConn } from '../stores/conn'
import { Modal } from './Modal'

/** F-CONN-14: asks before a switch cuts replies being written, room runs, uploads or unsaved agent settings. */
export function SwitchConfirm() {
  const ask = useConn((s) => s.switchAsk)
  if (!ask) return null
  const cancel = (): void => useConn.setState({ switchAsk: null })
  return (
    <Modal title="Switch server" onClose={cancel} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ margin: 0, color: '#F8F8F2' }}>Switch to {ask.name}? This stops:</p>
        <ul style={{ margin: 0, paddingLeft: 18, color: '#FFB86C' }}>
          {ask.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="cb" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="cb pri" onClick={() => switchServer(ask.id, true)}>
            Switch
          </button>
        </div>
      </div>
    </Modal>
  )
}
