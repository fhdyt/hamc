import { NEW_PROFILE_RE, DESCRIPTION_MAX, preview, profileCreateArgs, validDescription } from '@shared/agentOps'
import { Modal } from '../../components/Modal'
import { createProfile } from '../../agentOpsActions'
import { NEW_PROFILE_EMPTY, useAgentOps } from '../../stores/agentOps'
import { useAgents } from '../../stores/agents'
import { useConn } from '../../stores/conn'

export function nameProblem(name: string, existing: readonly string[]): string | null {
  if (!name) return 'Enter a name.'
  if (!NEW_PROFILE_RE.test(name)) return 'Use 2 to 24 lowercase letters, digits or dashes, starting with a letter.'
  if (name === 'default' || existing.includes(name)) return 'An agent with this name already exists.'
  return null
}

/** F-CFG-24: `hermes profile create` with a preview of the exact command; Create is the explicit action. */
export function NewProfileDialog() {
  const f = useAgentOps((s) => s.newProfile)
  const set = useAgentOps((s) => s.set)
  const agents = useAgents((s) => s.agents)
  const connected = useConn((s) => s.status.state === 'connected')
  if (!f.open) return null
  const patch = (p: Partial<typeof f>): void => set({ newProfile: { ...f, ...p, result: null, confirm: false } })
  const problem = nameProblem(f.name, agents.map((a) => a.profile))
  const descBad = !validDescription(f.description)
  const args = problem || descBad ? null : profileCreateArgs({ name: f.name, ...(f.description.trim() ? { description: f.description.trim() } : {}), ...(f.cloneFrom ? { cloneFrom: f.cloneFrom } : {}), noSkills: f.noSkills, alias: f.alias })
  const done = f.result?.ok === true

  return (
    <Modal title="New profile" onClose={() => set({ newProfile: NEW_PROFILE_EMPTY })} width={560}>
      <div className="ops np">
        <label className="np-field">
          <span>Name</span>
          <input className="fld" value={f.name} autoFocus spellCheck={false} maxLength={24} aria-invalid={f.name !== '' && problem !== null} onChange={(e) => patch({ name: e.target.value.trim() })} disabled={done} />
        </label>
        {f.name !== '' && problem && (
          <span className="sk-why bad" role="alert">
            {problem}
          </span>
        )}
        <label className="np-field">
          <span>Description (optional)</span>
          <input className="fld" value={f.description} maxLength={DESCRIPTION_MAX} placeholder="What this agent is good at; Kanban uses it to route tasks" onChange={(e) => patch({ description: e.target.value })} disabled={done} />
        </label>
        <label className="np-field">
          <span>Start from</span>
          <select className="fld" value={f.cloneFrom} onChange={(e) => patch({ cloneFrom: e.target.value })} disabled={done}>
            <option value="">An empty profile</option>
            {agents.map((a) => (
              <option key={a.profile} value={a.profile}>
                A copy of {a.displayName} (config, .env, SOUL.md, skills)
              </option>
            ))}
          </select>
        </label>
        <label className="ops-check">
          <input type="checkbox" checked={f.noSkills} onChange={(e) => patch({ noSkills: e.target.checked })} disabled={done} />
          No bundled skills (--no-skills)
        </label>
        <label className="ops-check">
          <input type="checkbox" checked={f.alias} onChange={(e) => patch({ alias: e.target.checked })} disabled={done} />
          Also create the wrapper command (Hermes writes a small script into ~/.local/bin)
        </label>
        <span className="cc-ask-body">This runs on the server:</span>
        <pre className="cc-cmd">{preview(args) ?? '—'}</pre>
        {f.confirm && args && (
          <div className="cc-ask" role="group" aria-label="Create this profile?">
            <span className="cc-ask-title">Create “{f.name}”?</span>
            <span className="cc-ask-body">Hermes creates profiles/{f.name} on the server{f.cloneFrom ? `, copying ${f.cloneFrom} (its .env included; Mission Control never reads it)` : ''}. It appears in the agent list within a few seconds.</span>
            <span className="cc-ask-actions">
              <button type="button" className="cb sm" onClick={() => set({ newProfile: { ...f, confirm: false } })}>
                Cancel
              </button>
              <button type="button" className="cb sm pri" onClick={() => void createProfile()}>
                Create profile
              </button>
            </span>
          </div>
        )}
        {f.result && (
          <div className={`banner ${f.result.ok ? 'ok' : 'bad'}`} role={f.result.ok ? 'status' : 'alert'}>
            <pre className="cc-note-text">{f.result.text}</pre>
          </div>
        )}
        <span className="cc-ask-actions">
          <button type="button" className="cb sm" onClick={() => set({ newProfile: NEW_PROFILE_EMPTY })}>
            {done ? 'Done' : 'Cancel'}
          </button>
          {!done && (
            <button type="button" className="cb sm pri" disabled={!args || !connected || f.busy} onClick={() => set({ newProfile: { ...f, confirm: true } })}>
              {f.busy ? 'Creating…' : 'Create…'}
            </button>
          )}
        </span>
      </div>
    </Modal>
  )
}
