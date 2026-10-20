import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { LABEL_MAX, type AuthMethod, type KeyInfo, type SavedConnection } from '@shared/ipc'
import { runConnect } from '../../actions'
import { validateConnectForm } from '../../lib/connectForm'
import { useConn } from '../../stores/conn'

interface Props {
  /** first: first-time setup; edit: a saved server; add: another server (F-CONN-14). */
  mode: 'first' | 'edit' | 'add'
  /** The saved server the form edits; null for a new one. */
  server: SavedConnection | null
  onConnected?: () => void
}

const METHODS: { id: AuthMethod; label: string }[] = [
  { id: 'password', label: 'Password' },
  { id: 'key', label: 'Private key' }
]

export function ConnectionForm({ mode, server, onConnected }: Props) {
  const saved = server
  const activeId = useConn((s) => s.saved?.id ?? null)
  const otherServer = mode === 'add' || (mode === 'edit' && !!saved && saved.id !== activeId)
  const secret = useConn((s) => s.secret)
  const connecting = useConn((s) => s.connecting)
  const connectError = useConn((s) => s.connectError)
  // The host key panel already explains this case.
  const error = connectError && !connectError.kind.startsWith('hostkey') ? connectError : null
  const [name, setName] = useState(saved?.label ?? '')
  const [host, setHost] = useState(saved?.host ?? '')
  const [port, setPort] = useState(String(saved?.port ?? 22))
  const [username, setUsername] = useState(saved?.username ?? '')
  const [auth, setAuth] = useState<AuthMethod>(saved?.authMethod ?? 'password')
  const [password, setPassword] = useState('')
  const [key, setKey] = useState<KeyInfo | null>(saved?.keyInfo ?? null)
  const [keyPath, setKeyPath] = useState<string | null>(saved?.keyPath ?? null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [remember, setRemember] = useState(saved?.remember ?? true)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)
  const refs = {
    host: useRef<HTMLInputElement>(null),
    port: useRef<HTMLInputElement>(null),
    username: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    key: useRef<HTMLButtonElement>(null),
    passphrase: useRef<HTMLInputElement>(null)
  }
  const methodRefs = useRef<(HTMLButtonElement | null)[]>([])
  const canRemember = secret?.canRemember ?? true
  const savedSecretFor = (m: AuthMethod): boolean => !!saved?.hasSecret && saved.authMethod === m

  async function chooseKey(): Promise<void> {
    setPickError(null)
    const r = await window.mc.connection.pickKey()
    if (r.ok) {
      setKey(r.key)
      setKeyPath(r.key.path)
      setPassphrase('')
      if (fieldError?.field === 'key') setFieldError(null)
    } else if (r.reason !== 'cancelled') {
      setPickError(r.message ?? 'This file cannot be used as a private key.')
    }
  }

  function onMethodKey(e: KeyboardEvent<HTMLButtonElement>, i: number): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + METHODS.length) % METHODS.length
    setAuth(METHODS[next]!.id)
    setFieldError(null)
    methodRefs.current[next]?.focus()
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const sameTarget = !!saved && saved.host === host.trim() && String(saved.port) === port.trim() && saved.username === username.trim()
    const check = validateConnectForm({
      host,
      port,
      username,
      auth,
      password,
      keyPath,
      keyEncrypted: key?.encrypted ?? false,
      passphrase,
      hasSavedSecret: savedSecretFor(auth),
      sameTarget,
      sameKey: sameTarget && !!keyPath && saved?.keyPath === keyPath
    })
    if (!check.ok) {
      setFieldError({ field: check.field, message: check.message })
      refs[check.field].current?.focus()
      return
    }
    // eslint-disable-next-line no-control-regex
    if (name.trim().length > LABEL_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
      setFieldError({ field: 'name', message: `Use at most ${LABEL_MAX} characters for the name.` })
      refs.name.current?.focus()
      return
    }
    setFieldError(null)
    const res = await runConnect({
      host: host.trim(),
      port: check.port,
      username: username.trim(),
      auth,
      ...(auth === 'password' && password ? { password } : {}),
      ...(auth === 'key' && keyPath ? { keyPath } : {}),
      ...(auth === 'key' && passphrase ? { passphrase } : {}),
      ...(saved ? { connectionId: saved.id } : {}),
      name: name.trim(),
      remember: remember && canRemember
    })
    setPassword('')
    setPassphrase('')
    if (res.ok) onConnected?.()
  }

  const err = (f: string): string | undefined => (fieldError?.field === f ? fieldError.message : undefined)
  const describedBy = (f: string): string | undefined => (err(f) ? 'cf-err' : undefined)
  const keyName = key?.name ?? (keyPath ? keyPath.split(/[\\/]/).pop() : null)
  const keychainHint = auth === 'password' ? '(password → OS keychain)' : key?.encrypted ? '(passphrase → OS keychain)' : null

  return (
    <form onSubmit={(e) => void submit(e)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="field">
        <label htmlFor="cf-name">
          name <span className="hint">(optional, shown in the server menu)</span>
        </label>
        <input
          id="cf-name"
          ref={refs.name}
          className="inp"
          value={name}
          maxLength={LABEL_MAX}
          placeholder={`${username.trim() || 'user'}@${host.trim() || 'host'}`}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!err('name')}
          aria-describedby={describedBy('name')}
        />
      </div>
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
        <span id="cf-method-label" className="cf-label">sign in with</span>
        <div className="cf-seg" role="radiogroup" aria-labelledby="cf-method-label">
          {METHODS.map((m, i) => (
            <button
              key={m.id}
              ref={(el) => {
                methodRefs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={auth === m.id}
              tabIndex={auth === m.id ? 0 : -1}
              onClick={() => {
                setAuth(m.id)
                setFieldError(null)
              }}
              onKeyDown={(e) => onMethodKey(e, i)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {auth === 'password' ? (
        <div className="field">
          <label htmlFor="cf-pass">
            password {mode === 'edit' && savedSecretFor('password') && <span className="hint">(leave empty to keep the saved password)</span>}
          </label>
          <input id="cf-pass" ref={refs.password} className="inp" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" aria-invalid={!!err('password')} aria-describedby={describedBy('password')} />
        </div>
      ) : (
        <>
          <div className="field">
            <span className="cf-label">private key file</span>
            {keyPath ? (
              <div className="cf-key">
                <code title={keyPath}>{keyName}</code>
                {key ? (
                  <span className="cf-key-facts">
                    {key.type}
                    {key.fingerprint && <> · {key.fingerprint}</>}
                  </span>
                ) : (
                  <span className="cf-key-facts warn">the saved key file was not found</span>
                )}
                <button type="button" ref={refs.key} className="cb sm" onClick={() => void chooseKey()}>
                  Change
                </button>
              </div>
            ) : (
              <button type="button" id="cf-key" ref={refs.key} className="cb cf-choose" onClick={() => void chooseKey()} aria-describedby={describedBy('key')}>
                Choose key file…
              </button>
            )}
            {pickError && (
              <p role="alert" className="cf-pick-err">
                {pickError}
              </p>
            )}
          </div>
          {key?.encrypted && (
            <div className="field">
              <label htmlFor="cf-phrase">
                passphrase {mode === 'edit' && savedSecretFor('key') && saved?.keyPath === keyPath && <span className="hint">(leave empty to keep the saved passphrase)</span>}
              </label>
              <input id="cf-phrase" ref={refs.passphrase} className="inp" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" aria-invalid={!!err('passphrase')} aria-describedby={describedBy('passphrase')} />
            </div>
          )}
          <p className="cf-help">The public key must already be in ~/.ssh/authorized_keys on the server. The app does not add it.</p>
        </>
      )}
      <label className="chk">
        <input type="checkbox" checked={remember && canRemember} disabled={!canRemember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          remember &amp; auto-connect on launch {keychainHint && <span style={{ color: '#8B95BD', fontSize: 12 }}>{keychainHint}</span>}
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
      {mode === 'first' ? (
        <p style={{ margin: 0, color: '#8B95BD', fontSize: 11 }}>
          Asked only once. Next time the app opens it connects automatically; change it anytime with{' '}
          <span style={{ color: '#50FA7B' }}>edit connection</span>. Nothing is installed or changed on your VPS.
        </p>
      ) : (
        otherServer && (
          <p style={{ margin: 0, color: '#8B95BD', fontSize: 11 }}>
            Saving connects to this server and disconnects the current one. Nothing is installed or changed on your VPS.
          </p>
        )
      )}
    </form>
  )
}
