import { useCallback, useEffect, useState } from 'react'
import { PRESETS } from '@shared/agentCfg'
import { AUX_TASKS, auxCommandLines, buildAuxSave, isAuto, resetAllChanges, type AuxChoice, type AuxSaveRequest, type AuxSlots, type AuxTask } from '@shared/auxModels'
import type { CatalogResult } from '@shared/modelCatalog'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { catalogModels } from '../../lib/modelCatalog'
import { useConn } from '../../stores/conn'

type Load = { s: 'loading' } | { s: 'error'; why: string } | { s: 'ok'; slots: AuxSlots }
const OTHER = '__other'
const PROVIDERS = PRESETS.map((p) => ({ slug: p.slug, label: p.label }))

interface Draft {
  provider: string
  other: string
  model: string
  baseUrl: string
}

const valueOf = (s: AuxSlots[AuxTask]): string => (isAuto(s) ? 'auto (main model)' : [s.provider, s.model || '(provider default)'].join(' · ') + (s.baseUrl ? ` · ${s.baseUrl}` : ''))

/** v2: the 18 side-job models of an agent; each change goes through `hermes config set` after the confirm. */
export function AuxModels({ profile, catalog }: { profile: string; catalog: CatalogResult | null }) {
  const connected = useConn((s) => s.status.state === 'connected')
  const [load, setLoad] = useState<Load>({ s: 'loading' })
  const [editing, setEditing] = useState<AuxTask | null>(null)
  const [draft, setDraft] = useState<Draft>({ provider: 'openrouter', other: '', model: '', baseUrl: '' })
  const [ask, setAsk] = useState<AuxSaveRequest | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const reload = useCallback(async () => {
    setLoad({ s: 'loading' })
    const r = await window.mc.agentCfg.auxRead(profile)
    if (r.ok) setLoad({ s: 'ok', slots: r.slots })
    else
      setLoad({
        s: 'error',
        why: r.error === 'no-yaml' ? "Hermes's Python on the server has no PyYAML, so the slots cannot be read." : r.error === 'not-connected' ? 'Connect to the server to read the auxiliary models.' : (r.detail ?? 'Hermes could not read the auxiliary models.')
      })
  }, [profile])

  useEffect(() => {
    setEditing(null)
    setNote(null)
    if (connected) void reload()
    else setLoad({ s: 'error', why: 'Connect to the server to read the auxiliary models.' })
  }, [profile, connected, reload])

  const slots = load.s === 'ok' ? load.slots : null
  const setCount = slots ? AUX_TASKS.filter((t) => !isAuto(slots[t.key])).length : 0

  const startEdit = (task: AuxTask): void => {
    const s = slots?.[task]
    const known = s && PROVIDERS.some((p) => p.slug === s.provider)
    setDraft({ provider: !s || isAuto(s) ? 'openrouter' : known ? s.provider : OTHER, other: s && !known && !isAuto(s) ? s.provider : '', model: s?.model ?? '', baseUrl: s?.baseUrl ?? '' })
    setEditing(task)
    setNote(null)
  }
  const choiceOf = (d: Draft): AuxChoice => ({ kind: 'model', provider: d.provider === OTHER ? d.other.trim() : d.provider, model: d.model.trim(), ...(d.provider === OTHER && d.baseUrl.trim() ? { baseUrl: d.baseUrl.trim() } : {}) })
  const draftPlan = editing ? buildAuxSave({ profile, changes: [{ task: editing, choice: choiceOf(draft) }] }) : null
  const suggestions = catalogModels(catalog, draft.provider === OTHER ? draft.other.trim() : draft.provider)

  const doSave = async (): Promise<void> => {
    if (!ask) return
    setSaving(true)
    const r = await window.mc.agentCfg.auxSave(ask)
    setSaving(false)
    setAsk(null)
    if (!r.ok) {
      setNote({ ok: false, text: r.detail })
      return
    }
    setEditing(null)
    if (r.slots) setLoad({ s: 'ok', slots: r.slots })
    else void reload()
    setNote({ ok: true, text: 'Saved. New sessions use these models.' })
  }

  const askPlan = ask ? buildAuxSave(ask) : null
  return (
    <details className="ax">
      <summary>
        Auxiliary models <span className="ag-note">· {slots ? (setCount === 0 ? 'all use the main model' : `${setCount} of ${AUX_TASKS.length} set`) : '…'}</span>
      </summary>
      <div className="ax-body">
        <p className="ag-note" style={{ margin: 0 }}>
          Side jobs Hermes may run on another model, for example a cheap fast one. <em>auto</em> uses the main model (with its fallbacks). Changes apply to new sessions. No key is read or written here.
        </p>
        {load.s === 'loading' && <span className="ag-note">Reading…</span>}
        {load.s === 'error' && (
          <div className="cv-banner bad" role="alert">
            <Icon name="alert" size={13} /> {load.why}
          </div>
        )}
        {slots && (
          <>
            <ul className="ax-list" aria-label="Auxiliary models">
              {AUX_TASKS.map((t) => {
                const s = slots[t.key]
                return (
                  <li key={t.key} className="ax-row">
                    <div className="ax-main">
                      <span className="ax-name" title={t.hint}>
                        {t.label}
                      </span>
                      <span className={`ax-val${isAuto(s) ? ' auto' : ''}`}>
                        {valueOf(s)}
                        {s.hasKey && <span className="ax-key"> · own key</span>}
                      </span>
                    </div>
                    <div className="ax-acts">
                      <button type="button" className="cb sm" aria-label={`Change ${t.label}`} onClick={() => startEdit(t.key)} disabled={!connected}>
                        Change
                      </button>
                      {!isAuto(s) && (
                        <button type="button" className="cb sm" aria-label={`Use the main model for ${t.label}`} onClick={() => setAsk({ profile, changes: [{ task: t.key, choice: { kind: 'auto' } }] })} disabled={!connected}>
                          Use main model
                        </button>
                      )}
                    </div>
                    {editing === t.key && (
                      <div className="ax-edit" role="group" aria-label={`${t.label} model`}>
                        <label className="ag-lbl">
                          Provider
                          <select className="fld" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}>
                            {PROVIDERS.map((p) => (
                              <option key={p.slug} value={p.slug}>
                                {p.label}
                              </option>
                            ))}
                            <option value={OTHER}>Other…</option>
                          </select>
                        </label>
                        {draft.provider === OTHER && (
                          <>
                            <label className="ag-lbl">
                              Provider name
                              <input className="fld" value={draft.other} onChange={(e) => setDraft({ ...draft, other: e.target.value.toLowerCase() })} placeholder="custom" maxLength={41} />
                            </label>
                            <label className="ag-lbl">
                              Base URL (optional)
                              <input className="fld" type="url" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://your-endpoint.example/v1" />
                            </label>
                          </>
                        )}
                        <label className="ag-lbl">
                          Model ID
                          <input className="fld" list={`ax-cat-${t.key}`} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="provider/model-name" spellCheck={false} />
                          <datalist id={`ax-cat-${t.key}`}>
                            {suggestions.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.default ? 'default' : m.description}
                              </option>
                            ))}
                          </datalist>
                        </label>
                        {draftPlan && !draftPlan.ok && <span className="ag-warn">{draftPlan.error}</span>}
                        <div className="ag-bar" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" className="cb sm" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                          <button type="button" className="cb sm pri" disabled={!draftPlan?.ok} onClick={() => setAsk({ profile, changes: [{ task: t.key, choice: choiceOf(draft) }] })}>
                            Save…
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="ag-bar">
              <button type="button" className="cb" disabled={!connected || setCount === 0} onClick={() => setAsk({ profile, changes: resetAllChanges(slots) })}>
                Reset all to auto…
              </button>
            </div>
          </>
        )}
        {note && (
          <div className={`cv-banner ${note.ok ? '' : 'bad'}`} role={note.ok ? 'status' : 'alert'}>
            <Icon name={note.ok ? 'check' : 'alert'} size={13} /> {note.text}
          </div>
        )}
      </div>
      {ask && askPlan?.ok && (
        <Modal title="Save auxiliary models" onClose={() => setAsk(null)} width={640}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span>
              This runs the commands below for <strong>{profile}</strong>. If one fails, the next ones do not run and Hermes’s message is shown.
            </span>
            <pre className="ag-pre">{auxCommandLines(profile, askPlan.steps)}</pre>
            <div className="ag-bar" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="cb" onClick={() => setAsk(null)}>
                Cancel
              </button>
              <button type="button" className="cb pri" onClick={() => void doSave()} disabled={saving}>
                <Icon name="save" size={12} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </details>
  )
}
