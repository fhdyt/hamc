import { useRef, useState, type FormEvent } from 'react'
import { runConnect } from '../../actions'
import { validateConnectForm } from '../../lib/connectForm'
import { useConn } from '../../stores/conn'

interface Props {
  mode: 'first' | 'edit'
  onConnected?: () => void
}

export function ConnectionForm({ mode, onConnected }: Props) {
  const saved = useConn((s) => s.saved)
  const secret = useConn((s) => s.secret)
  const connecting = useConn((s) => s.connecting)
  const error = useConn((s) => s.connectError)
  const [host, setHost] = useState(saved?.host ?? '')
  const [port, setPort] = useState(String(saved?.port ?? 22))
  const [username, setUsername] = useState(saved?.username ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(saved?.remember ?? true)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)
  const refs = {
    host: useRef<HTMLInputElement>(null),
    port: useRef<HTMLInputElement>(null),
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null)
  }
  const canRemember = secret?.canRemember ?? true

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const sameTarget = !!saved && saved.host === host.trim() && String(saved.port) === port.trim() && saved.username === username.trim()
    const check = validateConnectForm({ host, port, username, password, hasSavedPassword: !!saved?.hasPassword, sameTarget })
    if (!check.ok) {
      setFieldError({ field: check.field, message: check.message })
      refs[check.field].current?.focus()
      return
    }
    setFieldError(null)
    const res = await runConnect({
      host: host.trim(),
      port: check.port,
      username: username.trim(),
      ...(password ? { password } : {}),
      remember: remember && canRemember
    })
    setPassword('')
    if (res.ok) onConnected?.()
  }

  const err = (f: string): string | undefined => (fieldError?.field === f ? fieldError.message : undefined)
  const describedBy = (f: string): string | undefined => (err(f) ? 'cf-err' : undefined)

  return (
    <form onSubmit={(e) => void submit(e)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div className="field" style={{ flex: '3 1 220px' }}>
          <label htmlFor="cf-host">host / public ip</label>
          <input id="cf-host" ref={refs.host} className="inp" value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!err('host')} aria-describedby={describedBy('host')} />
        </div>
        <div className="field" style={{ flex: '1 1 90px' }}>
          <label htmlFor="cf-port">ssh port</label>
          <input id="cf-port" ref={refs.port} className="inp" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} aria-invalid={!!err('port')} aria-describedby={describedBy('port')} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cf-user">
          username <span className="hint">(the user that runs Hermes)</span>
        </label>
        <input id="cf-user" ref={refs.username} className="inp" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!err('username')} aria-describedby={describedBy('username')} />
      </div>
      <div className="field">
        <label htmlFor="cf-pass">
          password {mode === 'edit' && saved?.hasPassword && <span className="hint">(leave empty to keep the saved password)</span>}
        </label>
        <input id="cf-pass" ref={refs.password} className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" aria-invalid={!!err('password')} aria-describedby={describedBy('password')} />
      </div>
      <label className="chk">
        <input type="checkbox" checked={remember && canRemember} disabled={!canRemember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          remember &amp; auto-connect on launch <span style={{ color: '#8B95BD', fontSize: 12 }}>(password → OS keychain)</span>
        </span>
      </label>
      {!canRemember && secret?.reason && <p style={{ margin: 0, color: '#FFB86C', fontSize: 11 }}>{secret.reason}</p>}
      {(fieldError || error) && (
        <p id="cf-err" role="alert" style={{ margin: 0, color: '#FF5555', fontSize: 12 }}>
          {fieldError?.message ?? error?.message}
        </p>
      )}
      <button type="submit" className="btn-main" disabled={connecting}>
        {connecting ? '[ CONNECTING… ]' : mode === 'edit' ? '[ TEST & SAVE ]' : '[ TEST & CONNECT ]'}
      </button>
      <p style={{ margin: 0, color: '#8B95BD', fontSize: 11 }}>
        Asked only once. Next time the app opens it connects automatically; change it anytime with{' '}
        <span style={{ color: '#50FA7B' }}>edit connection</span>. Nothing is installed or changed on your VPS.
      </p>
    </form>
  )
}
