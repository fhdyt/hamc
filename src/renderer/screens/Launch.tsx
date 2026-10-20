import { useEffect, useRef } from 'react'
import logoUrl from '../assets/logo-mark.png'
import { runConnect } from '../actions'
import { launchOutcome, startupPct } from '../lib/launchOutcome'
import { serverAddress, serverName } from '../lib/servers'
import { useConn } from '../stores/conn'
import { useUi } from '../stores/ui'

const ICON = { done: '✓', running: '…', pending: '·', failed: '✕' } as const
const COLOR = { done: '#50FA7B', running: '#8BE9FD', pending: '#6272A4', failed: '#FF5555' } as const
const TEXT = { done: '#F8F8F2', running: '#8BE9FD', pending: '#8B95BD', failed: '#FF5555' } as const

export function Launch() {
  const saved = useConn((s) => s.saved)
  const startup = useConn((s) => s.startup)
  const error = useConn((s) => s.connectError)
  const navigate = useUi((s) => s.navigate)
  // F-CONN-14: a switch to another server bumps launchSeq, so the screen connects again
  const launchSeq = useConn((s) => s.launchSeq)
  const started = useRef<number | null>(null)

  useEffect(() => {
    if (started.current === launchSeq) return
    started.current = launchSeq
    void (async () => {
      const target = useConn.getState().saved
      if (!target) return navigate('connect')
      const res = await runConnect({ host: target.host, port: target.port, username: target.username, remember: target.remember, useSaved: true, connectionId: target.id })
      // a newer switch took over while this one connected
      if (started.current !== launchSeq) return
      if (res.ok) {
        window.setTimeout(() => {
          if (started.current === launchSeq && useUi.getState().route === 'launch') navigate('dashboard')
        }, 500)
        return
      }
      navigate(launchOutcome(res.kind) === 'dashboard-offline' ? 'dashboard' : 'connect')
    })()
  }, [launchSeq, navigate])

  const steps = startup?.steps ?? []
  return (
    <main className="center-screen" aria-label="Starting" style={{ justifyContent: 'center' }}>
      <div className="brand">
        <img src={logoUrl} width={96} height={96} alt="Hermes Agent Mission Control" style={{ alignSelf: 'center' }} />
        <div className="name">HERMES AGENT MISSION CONTROL</div>
        {saved && (
          <div style={{ color: '#A9B2D3' }}>
            auto-connecting to <span style={{ color: '#F8F8F2', fontWeight: 700 }}>{serverName(saved)}</span> · {serverAddress(saved)}
          </div>
        )}
      </div>
      <section aria-label="Startup steps" aria-live="polite" style={{ width: '100%', maxWidth: 560, boxSizing: 'border-box', border: '1px solid #44475A', borderRadius: 14, background: '#21222C', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((s) => (
          <div className="step" key={s.id}>
            <span style={{ width: 18, color: COLOR[s.state] }} aria-hidden="true">{ICON[s.state]}</span>
            <span style={{ color: TEXT[s.state] }}>{s.label}</span>
            <span className="detail">{s.detail}</span>
          </div>
        ))}
        <div style={{ height: 4, marginTop: 6, borderRadius: 2, background: '#44475A' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={startupPct(steps)}>
          <div style={{ height: 4, borderRadius: 2, width: `${startupPct(steps)}%`, background: '#50FA7B', transition: 'width .3s' }} />
        </div>
        {error && <p role="alert" style={{ margin: 0, color: '#FFB86C', fontSize: 12 }}>{error.message}</p>}
      </section>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="cbtn" onClick={() => navigate('connect')}>edit connection</button>
      </div>
    </main>
  )
}
