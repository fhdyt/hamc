import { useEffect, useState } from 'react'
import type { TermInfo } from '@shared/terminal'
import { saveSetting } from '../actions'
import { useUi } from '../stores/ui'
import { Row } from './parts'

/** Settings → Terminal: what the + of the Terminal panel opens and how server tabs reach the server. */
export function TerminalTab() {
  const s = useUi((st) => st.settings)
  const [info, setInfo] = useState<TermInfo | null>(null)
  useEffect(() => {
    void window.mc.terminal.info().then(setInfo)
  }, [])
  const via = s['terminal.serverVia']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Row label="New tabs open" hint="What the + of the Terminal panel starts. The arrow next to it always offers both.">
        <span className="seg" role="group" aria-label="New tabs open">
          <button type="button" aria-pressed={s['terminal.newShell'] === 'local'} onClick={() => void saveSetting('terminal.newShell', 'local')}>
            This computer
          </button>
          <button type="button" aria-pressed={s['terminal.newShell'] === 'server'} onClick={() => void saveSetting('terminal.newShell', 'server')}>
            Server (SSH)
          </button>
        </span>
      </Row>
      <Row
        label="SSH to the server with"
        hint={
          via === 'system'
            ? "Your computer's own ssh, in a terminal of this computer. It asks for the password (or uses your SSH key) and checks the server against the host key you trusted here."
            : "Mission Control's own connection: no password to type, and the shell ends when the app disconnects."
        }
      >
        <span className="seg" role="group" aria-label="SSH to the server with">
          <button type="button" aria-pressed={via === 'system'} onClick={() => void saveSetting('terminal.serverVia', 'system')}>
            System ssh
          </button>
          <button type="button" aria-pressed={via === 'builtin'} onClick={() => void saveSetting('terminal.serverVia', 'builtin')}>
            Built-in
          </button>
        </span>
      </Row>
      <section aria-label="This computer" className="banner" style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#A9B2D3' }}>
        {info === null ? (
          <span>Looking for the shell…</span>
        ) : (
          <>
            <span>
              Shell: <code>{info.localShell ?? 'not available'}</code>
              {info.problem && <span style={{ color: '#FF5555' }}> ({info.problem})</span>}
            </span>
            <span>
              ssh: <code>{info.ssh ?? 'not found'}</code>
              {!info.ssh && via === 'system' && <span> (server tabs use the built-in SSH shell)</span>}
            </span>
          </>
        )}
      </section>
      <p style={{ margin: 0, color: '#8B95BD', fontSize: 11 }}>Mission Control never types into a terminal (not even a password) and never logs what you type or what it prints.</p>
    </div>
  )
}
