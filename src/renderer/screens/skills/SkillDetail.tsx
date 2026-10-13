import type { Skill } from '@shared/events'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { Skeleton } from '../../components/States'
import { stripFrontmatter } from '../../lib/brain/markdown'
import { agentColor } from '../../lib/agentColor'
import { askView, curateBlock, facts, ORIGIN_COLOR, ORIGIN_LABEL, skillKey, STATE_COLOR } from '../../lib/skills'
import { askSkillAction, confirmSkillAction, loadDoc } from '../../skillsActions'
import { useConn } from '../../stores/conn'
import { useSkills } from '../../stores/skills'

/** SKILL.md of the picked skill with its facts and the curator actions (F-SKILL-3/4/7). */
export function SkillDetail({ skill, agentName }: { skill: Skill; agentName: string }) {
  const key = skillKey(skill)
  const doc = useSkills((s) => s.docs[key])
  const ask = useSkills((s) => (s.ask?.key === key ? s.ask : null))
  const closeAsk = useSkills((s) => s.closeAsk)
  const pending = useSkills((s) => s.pending === key)
  const note = useSkills((s) => s.notes[key] ?? null)
  const setNote = useSkills((s) => s.setNote)
  const connected = useConn((s) => s.status.state === 'connected')
  const block = curateBlock(skill)
  const off = !connected ? 'Reconnect to change skills.' : null
  const view = ask ? askView(ask.action, skill) : null
  const archived = skill.state === 'archived'

  return (
    <div className="sk-detail" data-key={key}>
      <div className="sk-dhead">
        <div className="sk-dtitle">
          <h2>
            {skill.category && <span className="sk-cat">{skill.category}/</span>}
            {skill.name}
          </h2>
          <span style={{ color: agentColor(skill.profile), fontWeight: 600 }}>{agentName}</span>
          <span className="tag" style={{ color: STATE_COLOR[skill.state], borderColor: STATE_COLOR[skill.state] }}>
            {skill.state}
          </span>
          <span className="tag" style={{ color: ORIGIN_COLOR[skill.origin] }}>
            {ORIGIN_LABEL[skill.origin]}
          </span>
          {skill.pinned && (
            <span className="tag" style={{ color: '#BD93F9', borderColor: '#BD93F9' }}>
              pinned
            </span>
          )}
        </div>
        {skill.description && <span className="sk-desc">{skill.description}</span>}
        <div className="sk-actions" role="group" aria-label="Skill actions">
          {block ? (
            <span className="sk-why">{block}</span>
          ) : (
            <>
              {!archived && (
                <button type="button" className="cb sm" aria-pressed={skill.pinned} disabled={off !== null || pending} title={off ?? undefined} onClick={() => askSkillAction(skill.pinned ? 'unpin' : 'pin')}>
                  <Icon name="flag" size={12} />
                  {skill.pinned ? 'Unpin' : 'Pin'}
                </button>
              )}
              <button type="button" className="cb sm" disabled={off !== null || pending} title={off ?? undefined} onClick={() => askSkillAction(archived ? 'restore' : 'archive')}>
                <Icon name="archive" size={12} />
                {pending ? 'Working…' : archived ? 'Restore' : 'Archive'}
              </button>
              {off && <span className="sk-why">{off}</span>}
            </>
          )}
        </div>
        {ask && view && (
          <div className="cc-ask mc-down" role="group" aria-label={view.title}>
            <span className="cc-ask-title">{view.title}</span>
            <span className="cc-ask-body">{view.body}</span>
            <span className="cc-ask-body">This runs on the server:</span>
            <pre className="cc-cmd">{view.command ?? '—'}</pre>
            <span className="cc-ask-actions">
              <button type="button" className="cb sm" onClick={closeAsk}>
                Cancel
              </button>
              <button type="button" className="cb sm pri" disabled={view.command === null} onClick={() => void confirmSkillAction()}>
                {view.confirm}
              </button>
            </span>
          </div>
        )}
        {note && (
          <div className={`banner ${note.ok ? 'ok' : 'bad'} sk-note`} role={note.ok ? 'status' : 'alert'}>
            <span className="cc-note-title">{note.title}</span>
            {note.detail && <pre className="cc-note-text">{note.detail}</pre>}
            <button type="button" className="ib sm cc-note-x" aria-label="Dismiss" onClick={() => setNote(key, null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
      </div>
      <div className="sk-dbody mc-fade">
        <dl className="sk-facts">
          {facts(skill).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {skill.envNames.length > 0 && (
          <div className="sk-env">
            <Icon name="lock" size={13} />
            <span>
              Needs environment variables: <code>{skill.envNames.join(', ')}</code>. Mission Control shows names only and never reads their values.
            </span>
          </div>
        )}
        <div className="sk-md">
          {(!doc || doc.status === 'loading') && <Skeleton rows={4} />}
          {doc?.status === 'error' && (
            <div className="banner bad" role="alert">
              {doc.message}
              <button type="button" className="cb sm" onClick={() => void loadDoc(skill.profile, skill.path, true)}>
                Retry
              </button>
            </div>
          )}
          {doc?.status === 'ok' && <Markdown text={stripFrontmatter(doc.text)} className="sk-mdtext" kind="doc" />}
          {doc?.status === 'ok' && doc.truncated && <span className="sk-why">Only the first 256 KiB are shown.</span>}
        </div>
        <span className="sk-why">
          {skill.profile === 'default' ? '~/.hermes' : `~/.hermes/profiles/${skill.profile}`}/skills/{skill.path}/SKILL.md · “created by” is a policy marker Hermes keeps, not proof of who wrote the skill.
        </span>
      </div>
    </div>
  )
}
