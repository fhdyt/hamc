import { useEffect, useState } from 'react'
import { forgetConnection } from '../actions'
import { formatAge } from '../lib/format'
import { serverAddress, serverName } from '../lib/servers'
import { EditConnectionDialogBody } from '../screens/EditConnectionDialog'
import { loadServers, switchServer } from '../serverActions'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'

const STATE_TAG: Record<string, string> = { connected: 'Active', connecting: 'Connecting', reconnecting: 'Reconnecting', offline: 'Offline', idle: 'Not connected' }

/** Settings → Servers (F-CONN-14..17): every saved server with Connect, Edit and Forget, and Add server. */
export function ServersTab({ onDone }: { onDone: () => void }) {
  const servers = useConn((s) => s.servers)
  const activeId = useConn((s) => s.saved?.id ?? null)
  const state = useConn((s) => s.status.state)
  const adding = useUi((s) => s.serversAdd)
  const [editing, setEditing] = useState<number | 'new' | null>(adding ? 'new' : null)
  const [forget, setForget] = useState<number | null>(null)

  useEffect(() => {
    void loadServers()
  }, [])
  useEffect(() => {
    if (adding) setEditing('new')
  }, [adding])

  if (editing !== null) {
    const server = editing === 'new' ? null : (servers.find((s) => s.id === editing) ?? null)
    return (
      <div className="sv-edit">
        <div className="sv-edit-head">
          <button type="button" className="cb sm" onClick={() => setEditing(null)}>
            ← All servers
          </button>
          <h2 className="sv-title">{server ? `Edit ${serverName(server)}` : 'Add server'}</h2>
        </div>
        <EditConnectionDialogBody server={server} onDone={onDone} />
      </div>
    )
  }

  const now = Date.now()
  return (
    <div className="sv">
      <p className="sv-help">One server is connected at a time. Switching disconnects the current server; nothing changes on either VPS.</p>
      <ul className="sv-list" aria-label="Saved servers">
        {servers.map((s) => {
          const name = serverName(s)
          const active = s.id === activeId
          return (
            <li key={s.id} className={`sv-row${active ? ' on' : ''}`}>
              <div className="sv-main">
                <div className="sv-line">
                  <span className="sv-name">{name}</span>
                  {active && <span className="sv-tag">{STATE_TAG[state] ?? 'Active'}</span>}
                </div>
                <span className="sv-sub">
                  {serverAddress(s)} · {s.authMethod === 'key' ? 'private key' : 'password'} ·{' '}
                  {s.lastConnectedAt ? `connected ${formatAge(Math.max(0, (now - s.lastConnectedAt) / 1000))}` : 'never connected'}
                </span>
              </div>
              <div className="sv-acts">
                {!(active && state !== 'idle') && (
                  <button type="button" className="cb sm" aria-label={`Connect to ${name}`} onClick={() => switchServer(s.id)}>
                    Connect
                  </button>
                )}
                <button type="button" className="cb sm" aria-label={`Edit ${name}`} onClick={() => setEditing(s.id)}>
                  Edit
                </button>
                <button type="button" className="cb sm dng" aria-label={`Forget ${name}`} onClick={() => setForget(s.id)}>
                  Forget…
                </button>
              </div>
              {forget === s.id && (
                <div className="sv-forget" role="group" aria-label={`Forget ${name}`}>
                  <span>
                    This removes {name}, its password or key passphrase, its trusted host key, pinned agents, photos and rooms from this
                    computer. The key file itself stays where it is. Nothing changes on your VPS.
                    {active && ' The app disconnects from it.'}
                  </span>
                  <div className="sv-acts">
                    <button
                      type="button"
                      className="cb sm dng"
                      onClick={() => {
                        setForget(null)
                        void forgetConnection(s.id)
                      }}
                    >
                      Forget this server
                    </button>
                    <button type="button" className="cb sm" onClick={() => setForget(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div>
        <button type="button" className="cb" onClick={() => setEditing('new')}>
          + Add server
        </button>
      </div>
    </div>
  )
}
