import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CUSTOM_SLUG, EFFORTS, PRESETS, type ModelState, type RemoteModel, type TestModelResult } from '@shared/agentCfg'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { ErrorState, Skeleton } from '../../components/States'
import { credLabel, fetchErrorText, formDirty, formFromState, presetOf, previewOf, requestOf, summaryLines, withProvider, type ModelForm } from '../../lib/modelForm'
import { useAgentCfg } from '../../stores/agentCfg'
import { useConn } from '../../stores/conn'
import type { CatalogResult } from '@shared/modelCatalog'
import { catalogModels, sourceLine } from '../../lib/modelCatalog'
import { AuxModels } from './AuxModels'
import { DiffView } from './DiffView'
import { RestartDialog } from './Dialogs'

type Load = { s: 'loading' } | { s: 'error'; why: string } | { s: 'ok'; state: ModelState }
type Fetch = { s: 'idle' } | { s: 'busy' } | { s: 'ok'; models: RemoteModel[] } | { s: 'error'; why: string }
type Note = { ok: boolean; text: string; warnings?: string[] } | null

/** Provider → Base URL → API key → fetch models → pick → Test → Save (F-CFG-1..9). */
export function ModelTab({ profile }: { profile: string }) {
  const connected = useConn((s) => s.status.state === 'connected')
  const setDirty = useAgentCfg((s) => s.setModelDirty)
  const [load, setLoad] = useState<Load>({ s: 'loading' })
  const [initial, setInitial] = useState<ModelForm | null>(null)
  const [form, setForm] = useState<ModelForm | null>(null)
  const [fetched, setFetched] = useState<Fetch>({ s: 'idle' })
  const [filter, setFilter] = useState('')
  const [test, setTest] = useState<TestModelResult | 'busy' | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<Note>(null)
  const [restart, setRestart] = useState(false)
  const [keyArg, setKeyArg] = useState(false)
  const [catalog, setCatalog] = useState<CatalogResult | null>(null)
  const gen = useRef(0)

  const reload = useCallback(async () => {
    const g = ++gen.current
    setLoad({ s: 'loading' })
    const r = await window.mc.agentCfg.readModel(profile)
    if (g !== gen.current) return
    if (!r.ok) {
      setLoad({ s: 'error', why: r.error === 'not-connected' ? 'Connect to the server to read this agent’s model.' : (r.detail ?? 'Hermes could not read the model settings.') })
      return
    }
    const f = formFromState(r.state)
    setLoad({ s: 'ok', state: r.state })
    setInitial(f)
    setForm(f)
    setFetched({ s: 'idle' })
    setTest(null)
  }, [profile])

  useEffect(() => {
    setNote(null)
    if (connected) void reload()
    else setLoad({ s: 'error', why: 'Connect to the server to read this agent’s model.' })
  }, [profile, connected, reload])
  useEffect(() => {
    void window.mc.agentCfg.keyAsArgument().then(setKeyArg)
  }, [profile, connected])
  // v2: the Hermes model catalog (the server's cache, else the public manifest)
  useEffect(() => {
    let live = true
    setCatalog(null)
    if (connected) void window.mc.agentCfg.catalog(profile).then((c) => live && setCatalog(c))
    return () => {
      live = false
    }
  }, [profile, connected])

  const dirty = !!form && !!initial && formDirty(form, initial)
  useEffect(() => {
    setDirty(profile, dirty)
    return () => setDirty(profile, false)
  }, [profile, dirty, setDirty])

  const preview = useMemo(() => (form ? previewOf(profile, form) : null), [profile, form])
  const shown = useMemo(() => {
    if (fetched.s !== 'ok') return []
    const q = filter.trim().toLowerCase()
    return q ? fetched.models.filter((m) => m.id.toLowerCase().includes(q)) : fetched.models
  }, [fetched, filter])

  if (load.s === 'loading' || !form) {
    if (load.s === 'error') return <ErrorState title="Model settings unavailable" why={load.why} onRetry={connected ? () => void reload() : undefined} />
    return <Skeleton rows={6} />
  }
  if (load.s === 'error') return <ErrorState title="Model settings unavailable" why={load.why} onRetry={connected ? () => void reload() : undefined} />

  const server = load.state
  const preset = presetOf(form.provider)
  const custom = form.provider === CUSTOM_SLUG
  const needsKey = custom || preset?.auth === 'key'
  const slugForCred = custom ? form.customName : form.provider
  const set = (patch: Partial<ModelForm>): void => {
    setNote(null)
    setForm({ ...form, ...patch })
  }
  const efforts = form.effort && !(EFFORTS as readonly string[]).includes(form.effort) ? [form.effort, ...EFFORTS] : EFFORTS

  const doFetch = async (): Promise<void> => {
    setFetched({ s: 'busy' })
    const r = await window.mc.agentCfg.fetchModels({ baseUrl: form.baseUrl, ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}) })
    setFetched(r.ok ? { s: 'ok', models: r.models } : { s: 'error', why: fetchErrorText(r, form.apiKey.trim() !== '') })
    setFilter('')
  }
  const doTest = async (): Promise<void> => {
    setTest('busy')
    setTest(await window.mc.agentCfg.testModel(profile))
  }
  const doSave = async (): Promise<void> => {
    setSaving(true)
    const r = await window.mc.agentCfg.saveModel(requestOf(profile, form))
    setSaving(false)
    setConfirm(false)
    if (!r.ok) {
      setNote({ ok: false, text: r.detail })
      return
    }
    // F-CFG-6: the key field is emptied the moment it was sent, and the key is never shown again.
    const f = { ...formFromState(r.state.provider || r.state.model ? r.state : server), apiKey: '' }
    setLoad({ s: 'ok', state: r.state.provider || r.state.model ? r.state : server })
    setInitial(f)
    setForm(f)
    setNote({ ok: true, text: 'Saved. New sessions use this model.', warnings: r.warnings })
  }

  const before = summaryLines(server.provider, server.model, server.baseUrl, server.effort)
  const planOk = preview?.plan.ok === true
  const after = summaryLines(preview?.plan.ok ? preview.plan.slug : null, form.model.trim() || null, form.baseUrl.trim() || null, form.effort)
  const cred = credLabel(slugForCred, server.creds)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <dl className="kv" style={{ margin: 0 }}>
        <dt>now</dt>
        <dd>{[server.provider, server.model].filter(Boolean).join(' · ') || 'not set'}</dd>
        <dt>reasoning</dt>
        <dd>{server.effort ?? 'default'}</dd>
      </dl>

      <div className="ag-prov" role="radiogroup" aria-label="Provider">
        {[...PRESETS, { slug: CUSTOM_SLUG, label: 'Custom', auth: 'key' as const }].map((p) => {
          const c = p.slug === CUSTOM_SLUG ? { text: 'any OpenAI-compatible endpoint', ok: false } : credLabel(p.slug, server.creds)
          return (
            <button key={p.slug} type="button" role="radio" aria-checked={form.provider === p.slug} className="ag-pv" onClick={() => { setForm(withProvider(form, p.slug)); setFetched({ s: 'idle' }); setNote(null) }}>
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span className={`sub${c.ok ? ' ok' : ''}`}>{c.text}</span>
            </button>
          )
        })}
      </div>

      {custom && (
        <label className="ag-lbl">
          Provider name
          <input className="fld" value={form.customName} onChange={(e) => set({ customName: e.target.value.toLowerCase() })} placeholder="my-proxy" maxLength={24} />
        </label>
      )}
      {preset?.auth === 'oauth' ? (
        <span className="ag-note">
          Signed in with OAuth. Sign in again from a terminal: <code>hermes {profile === 'default' ? '' : `-p ${profile} `}auth add nous --type oauth</code>
        </span>
      ) : (
        <label className="ag-lbl">
          Base URL
          <input className="fld" type="url" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://your-endpoint.example/v1" />
        </label>
      )}
      {needsKey && (
        <label className="ag-lbl">
          <span>
            API key <span className="ag-note">{cred.ok ? ' · a key is saved; leave empty to keep it' : ' · not saved yet'}</span>
          </span>
          <input className="fld" type="password" autoComplete="off" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={cred.ok ? '••••••••' : 'Paste the key'} />
        </label>
      )}
      {needsKey && form.apiKey.trim() !== '' && keyArg && (
        <div className="cv-banner warn" role="status">
          <Icon name="alert" size={13} /> This Hermes cannot take the key on stdin, so it goes to <code>hermes config set</code> as an argument. On a server shared with other users it can be seen in the process list for under a second.
        </div>
      )}

      {catalog?.ok && catalogModels(catalog, form.provider).length > 0 && (
        <div className="ag-cat">
          <span className="ag-lbl" id="ag-cat-label">
            Hermes catalog <span className="ag-note">· {sourceLine(catalog)}</span>
          </span>
          <div className="ag-models" role="radiogroup" aria-labelledby="ag-cat-label">
            {catalogModels(catalog, form.provider).map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={form.model === m.id} className="ag-model" onClick={() => set({ model: m.id })}>
                <span>{m.id}</span>
                {(m.default || m.description) && <span className="ctx">{m.default ? 'default' : m.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ag-bar">
        <button type="button" className="cb" onClick={() => void doFetch()} disabled={!connected || fetched.s === 'busy' || preset?.auth === 'oauth'}>
          <Icon name="refresh" size={12} /> {fetched.s === 'busy' ? 'Fetching…' : 'Fetch models'}
        </button>
        <span className="ag-note">Asks the endpoint from the server, so endpoints only the server can reach work too.{needsKey && cred.ok && !form.apiKey ? ' A saved key is not read back: enter it to list models that need one.' : ''}</span>
      </div>
      {fetched.s === 'error' && (
        <div className="cv-banner bad" role="alert">
          <Icon name="alert" size={13} /> {fetched.why}
        </div>
      )}
      {fetched.s === 'ok' && (
        <>
          <input className="fld" type="search" aria-label="Filter models" placeholder={`Filter ${fetched.models.length} models`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="ag-models" role="radiogroup" aria-label="Models">
            {shown.length === 0 && <span className="ag-note" style={{ padding: 8, display: 'block' }}>No model matches.</span>}
            {shown.slice(0, 300).map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={form.model === m.id} className="ag-model" onClick={() => set({ model: m.id })}>
                <span>{m.id}</span>
                {m.ctx && <span className="ctx">ctx {m.ctx.toLocaleString('en-US')}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      <label className="ag-lbl">
        Model ID
        <input className="fld" value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="provider/model-name" spellCheck={false} />
      </label>
      {server.model !== form.model.trim() && form.model.trim() !== '' && fetched.s === 'ok' && !fetched.models.some((m) => m.id === form.model.trim()) && (
        <span className="ag-warn">This model ID is not in the list the endpoint returned. Hermes does not check it.</span>
      )}

      <div className="ag-row" role="group" aria-label="Reasoning effort">
        <span style={{ color: '#a9b2d3', marginRight: 4 }}>Reasoning</span>
        {efforts.map((e) => (
          <button key={e} type="button" className="cb sm" aria-pressed={form.effort === e} onClick={() => set({ effort: form.effort === e ? null : e })}>
            {e}
          </button>
        ))}
      </div>

      <pre className="ag-pre" aria-label="Commands">{planOk ? preview!.commands : preview?.plan.ok === false ? `# ${preview.plan.error}` : ''}</pre>

      <div className="ag-bar">
        <button type="button" className="cb" onClick={() => void doTest()} disabled={!connected || test === 'busy'} title="Asks the agent’s saved model to reply OK">
          <Icon name="play" size={11} /> {test === 'busy' ? 'Testing…' : 'Test saved model'}
        </button>
        <button type="button" className="cb pri" onClick={() => setConfirm(true)} disabled={!connected || !planOk || !dirty || saving} title={!planOk ? 'Choose a model first' : !dirty ? 'Nothing to save' : 'Review the commands and save'}>
          <Icon name="save" size={12} /> Save
        </button>
        {dirty && (
          <span className="ag-dirty">
            <span className="dot" style={{ background: '#FFB86C' }} /> unsaved
          </span>
        )}
        {test && test !== 'busy' && (
          <span className={test.ok ? 'ag-ok' : 'ag-bad'} role="status">
            {test.ok ? `✓ ${(test.ms / 1000).toFixed(1)} s · “${test.answer.slice(0, 40)}”` : `✗ ${test.detail}`}
          </span>
        )}
      </div>

      {note && (
        <div className={`cv-banner ${note.ok ? '' : 'bad'}`} role={note.ok ? 'status' : 'alert'}>
          <Icon name={note.ok ? 'check' : 'alert'} size={13} /> {note.text}
          {note.ok && (
            <button type="button" className="cb sm" onClick={() => setRestart(true)}>
              Restart this agent’s gateway…
            </button>
          )}
        </div>
      )}
      {note?.warnings?.map((w) => (
        <div key={w} className="cv-banner warn" role="status">
          <Icon name="alert" size={13} /> {w}
        </div>
      ))}
      <span className="ag-note">Changes apply to new sessions. The key is sent to Hermes once and never read back.</span>

      <AuxModels profile={profile} catalog={catalog} />

      {confirm && preview?.plan.ok && (
        <Modal title="Save model settings" onClose={() => setConfirm(false)} width={640}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span>
              This runs the commands below for <strong>{profile}</strong>. If one fails, the next ones do not run and Hermes’s message is shown.
            </span>
            <pre className="ag-pre">{preview.commands}</pre>
            <DiffView before={before} after={after} label="Configuration" />
            <div className="ag-bar" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="cb" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="cb pri" onClick={() => void doSave()} disabled={saving}>
                <Icon name="save" size={12} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {restart && <RestartDialog profile={profile} onClose={() => setRestart(false)} />}
    </div>
  )
}
