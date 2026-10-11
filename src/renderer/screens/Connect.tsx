import logoUrl from '../assets/logo-mark.png'
import { trustAndRetry } from '../actions'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'
import { ConnectionForm } from './connect/ConnectionForm'
import { HostKeyPanel } from './connect/HostKeyPanel'
import { PreflightPanel } from './connect/PreflightPanel'

export function Connect() {
  const saved = useConn((s) => s.saved)
  const hostKey = useConn((s) => s.hostKey)
  const navigate = useUi((s) => s.navigate)

  function open(): void {
    window.setTimeout(() => navigate('dashboard'), 700)
  }

  async function trust(): Promise<void> {
    const res = await trustAndRetry()
    if (res?.ok) open()
  }

  return (
    <main className="center-screen" aria-label="Connect to your VPS">
      <div className="brand">
        <img src={logoUrl} width={96} height={96} alt="Hermes Agent Mission Control" style={{ alignSelf: 'center' }} />
        <div className="name">HERMES AGENT MISSION CONTROL</div>
        <div style={{ color: '#A9B2D3' }}>remote ops console for Hermes Agent · zero-change · read-only by default</div>
      </div>
      <div style={{ width: '100%', maxWidth: 1120, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <section className="pnl hi" aria-label="Connect to VPS" style={{ flex: '1 1 380px', padding: '26px 20px 20px' }}>
          <h1 className="pt" style={{ fontSize: 12 }}>┤ {saved ? 'edit connection' : 'first-time setup'} ├</h1>
          <ConnectionForm mode={saved ? 'edit' : 'first'} onConnected={open} />
        </section>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {hostKey && <HostKeyPanel onTrust={() => void trust()} onCancel={() => useConn.setState({ hostKey: null })} />}
          <PreflightPanel />
        </div>
      </div>
    </main>
  )
}
