import { useConn } from '../../stores/conn'

export function HostKeyPanel({ onTrust, onCancel }: { onTrust: () => void; onCancel: () => void }) {
  const hk = useConn((s) => s.hostKey)
  if (!hk) return null
  const changed = hk.changed
  const accent = changed ? '#FF5555' : '#FFB86C'
  return (
    <section className={`pnl ${changed ? 'bad' : 'warn'}`} aria-label="Host key verification" role="alertdialog" aria-describedby="hk-desc">
      <h2 className="pt">┤ {changed ? 'host key changed: do not continue unless you know why' : 'first connection: verify host key'} ├</h2>
      <div id="hk-desc" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          {hk.host} presented {changed ? 'a different' : 'an'} <span style={{ color: accent }}>{hk.algo.replace('ssh-', '').toUpperCase()}</span> key:
        </div>
        <code style={{ display: 'block', padding: '8px 10px', background: '#282A36', border: `1px dashed ${accent}`, color: accent, overflowWrap: 'anywhere' }}>{hk.fingerprint}</code>
        {changed && hk.previous && (
          <div style={{ color: '#A9B2D3', fontSize: 12 }}>
            Previously trusted: <span style={{ color: '#F8F8F2', overflowWrap: 'anywhere' }}>{hk.previous}</span>. A changed key can mean the server was reinstalled, or that someone is intercepting the connection.
          </div>
        )}
        <div style={{ color: '#A9B2D3', fontSize: 12 }}>
          Compare with <span style={{ color: '#F8F8F2' }}>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</span> on the server.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {changed ? (
            <>
              <button type="button" className="btn-bad-o" onClick={onTrust}>I verified it: trust new key</button>
              <button type="button" className="btn-warn" onClick={onCancel}>CANCEL</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-warn" onClick={onTrust}>TRUST &amp; CONTINUE</button>
              <button type="button" className="btn-warn-o" onClick={onCancel}>CANCEL</button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
