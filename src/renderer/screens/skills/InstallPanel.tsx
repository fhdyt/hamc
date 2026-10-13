import { commandPreview, skillActionArgs, skillInspectArgs } from '@shared/skills'
import { Icon } from '../../components/Icon'
import { installProblem } from '../../lib/skills'
import { closeInstall, inspectHub, installHub } from '../../skillsActions'
import { useConn } from '../../stores/conn'
import { useSkills } from '../../stores/skills'

/** Install from hub (F-SKILL-5): inspect first, then the install command after an explicit confirm. */
export function InstallPanel({ agents }: { agents: { profile: string; displayName: string }[] }) {
  const inst = useSkills((s) => s.install)
  const patch = useSkills((s) => s.patchInstall)
  const connected = useConn((s) => s.status.state === 'connected')
  const id = inst.id.trim()
  const problem = inst.id === '' ? null : installProblem(inst.id)
  const ready = inst.id !== '' && problem === null
  const category = inst.category.trim()
  const installCmd = ready ? commandPreview(skillActionArgs({ action: 'install', profile: inst.profile, id, ...(category ? { category } : {}) })) : null
  const inspectCmd = ready ? commandPreview(skillInspectArgs(inst.profile, id)) : null

  return (
    <section className="sk-install mc-down" aria-label="Install a skill">
      <div className="sk-install-row">
        <label htmlFor="sk-install-id">Skill id or source</label>
        <input
          id="sk-install-id"
          type="text"
          className="fld sk-install-id"
          autoComplete="off"
          spellCheck={false}
          value={inst.id}
          placeholder="official/migration/openclaw-migration"
          aria-invalid={problem !== null}
          aria-describedby="sk-install-help"
          onChange={(e) => patch({ id: e.target.value, inspect: null, confirm: false, note: null })}
        />
        <label htmlFor="sk-install-for">For</label>
        <select id="sk-install-for" className="fld" value={inst.profile} onChange={(e) => patch({ profile: e.target.value, inspect: null, confirm: false })}>
          {agents.map((a) => (
            <option key={a.profile} value={a.profile}>
              {a.displayName}
            </option>
          ))}
        </select>
        <label htmlFor="sk-install-cat">Category</label>
        <input id="sk-install-cat" type="text" className="fld sk-install-cat" autoComplete="off" spellCheck={false} value={inst.category} placeholder="optional" onChange={(e) => patch({ category: e.target.value, confirm: false })} />
      </div>
      <span id="sk-install-help" className={`sk-why${problem ? ' bad' : ''}`} role={problem ? 'alert' : undefined}>
        {problem ?? 'Inspect shows what the skill contains before anything is written. Install copies it into the profile’s skills folder after Hermes’s own safety scan; a blocked scan stops it.'}
      </span>
      {inspectCmd && installCmd && (
        <pre className="cc-cmd">
          {inspectCmd}
          {'\n'}
          {installCmd}
        </pre>
      )}
      {inst.inspect?.status === 'loading' && (
        <span role="status" className="sk-why">
          Inspecting…
        </span>
      )}
      {inst.inspect?.status === 'error' && (
        <div className="banner bad" role="alert">
          {inst.inspect.message}
        </div>
      )}
      {inst.inspect?.status === 'ok' && (
        <pre className="cron-pre sk-inspect" aria-label="Inspect output">
          {inst.inspect.text || '(no output)'}
        </pre>
      )}
      {inst.confirm && installCmd && (
        <div className="cc-ask" role="group" aria-label="Install this skill?">
          <span className="cc-ask-title">Install this skill?</span>
          <span className="cc-ask-body">Hermes downloads it, runs its safety scan and writes it into the skills folder. Mission Control answers Hermes’s own prompt with --yes because nobody can type into it; --force is never used.</span>
          <pre className="cc-cmd">{installCmd}</pre>
          <span className="cc-ask-actions">
            <button type="button" className="cb sm" onClick={() => patch({ confirm: false })}>
              Cancel
            </button>
            <button type="button" className="cb sm pri" onClick={() => void installHub()}>
              Install
            </button>
          </span>
        </div>
      )}
      {inst.note && (
        <div className={`banner ${inst.note.ok ? 'ok' : 'bad'}`} role={inst.note.ok ? 'status' : 'alert'}>
          <span className="cc-note-title">{inst.note.title}</span>
          {inst.note.detail && <pre className="cc-note-text">{inst.note.detail}</pre>}
        </div>
      )}
      <span className="sk-install-actions">
        <button type="button" className="cb sm" onClick={closeInstall}>
          Close
        </button>
        <button type="button" className="cb sm" disabled={!ready || !connected || inst.inspect?.status === 'loading'} onClick={() => void inspectHub()}>
          Inspect first
        </button>
        <button type="button" className="cb sm pri" disabled={!ready || !connected || inst.busy || inst.inspect?.status !== 'ok'} title={inst.inspect?.status !== 'ok' ? 'Inspect the skill first.' : undefined} onClick={() => patch({ confirm: true })}>
          <Icon name="download" size={12} />
          {inst.busy ? 'Installing…' : 'Install skill'}
        </button>
      </span>
    </section>
  )
}
