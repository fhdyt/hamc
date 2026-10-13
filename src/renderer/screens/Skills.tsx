import { useEffect, useMemo } from 'react'
import { saveSetting } from '../actions'
import { Icon } from '../components/Icon'
import { EmptyState, Skeleton } from '../components/States'
import { agentColor } from '../lib/agentColor'
import { sortAgents } from '../lib/roster'
import { ago, byAgent, filterSkills, kindCounts, KINDS, ORIGIN_COLOR, ORIGIN_LABEL, skillKey, STATE_COLOR, summary } from '../lib/skills'
import { closeInstall, loadSkills, openInstall, selectSkill } from '../skillsActions'
import { useAgents } from '../stores/agents'
import { useSkills, type SkillsTab } from '../stores/skills'
import { useUi } from '../stores/ui'
import { ChangesTab } from './skills/ChangesTab'
import { InstallPanel } from './skills/InstallPanel'
import { SkillDetail } from './skills/SkillDetail'

const REFRESH_MS = 30_000
const MAX_AGENT_CHIPS = 8
const TABS: { id: SkillsTab; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'changes', label: 'Changes' }
]

export function Skills() {
  const tab = useSkills((s) => s.tab)
  const setTab = useSkills((s) => s.setTab)
  const kind = useSkills((s) => s.kind)
  const setKind = useSkills((s) => s.setKind)
  const q = useSkills((s) => s.q)
  const setQ = useSkills((s) => s.setQ)
  const status = useSkills((s) => s.status)
  const error = useSkills((s) => s.error)
  const list = useSkills((s) => s.list)
  const selected = useSkills((s) => s.selected)
  const install = useSkills((s) => s.install.open)
  const agentSetting = useUi((s) => s.settings['filters.agent'])
  const agents = useAgents((s) => s.agents)
  const roster = useMemo(() => sortAgents(agents), [agents])
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.profile, a.displayName])), [agents])
  const agent = agentSetting !== 'all' && !roster.some((a) => a.profile === agentSetting) ? 'all' : agentSetting

  useEffect(() => {
    void loadSkills()
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSkills(true)
    }, REFRESH_MS)
    return () => window.clearInterval(t)
  }, [])

  const all = list?.skills ?? []
  const scoped = useMemo(() => byAgent(all, agent), [all, agent])
  const counts = useMemo(() => kindCounts(scoped), [scoped])
  const rows = useMemo(() => filterSkills(all, { agent, kind, q }), [all, agent, kind, q])
  const sel = all.find((s) => skillKey(s) === selected) ?? null
  const now = Date.now() / 1000
  const profileErrors = (list?.profiles ?? []).filter((p) => !p.ok && (agent === 'all' || p.profile === agent))
  const changeProfiles = agent === 'all' ? roster.map((a) => a.profile).slice(0, 20) : [agent]

  return (
    <div className="sk">
      <div className="sk-head">
        <h1 className="page-title">Skills</h1>
        {list && <span className="sk-sum">{summary(scoped)}</span>}
        <span className="sk-src">source: skills/ · .usage.json · curator ledger</span>
      </div>
      <div className="sk-bar">
        <div role="tablist" aria-label="Skills views" className="us-tabs sk-tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`sk-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="sk-panel" className="us-tab" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {roster.length > MAX_AGENT_CHIPS ? (
          <select aria-label="Agent" className="fld" value={agent} onChange={(e) => void saveSetting('filters.agent', e.target.value)}>
            <option value="all">All agents</option>
            {roster.map((a) => (
              <option key={a.profile} value={a.profile}>
                {a.displayName}
              </option>
            ))}
          </select>
        ) : (
          <div className="ses-chips" role="group" aria-label="Agent">
            <button type="button" className="fchip" aria-pressed={agent === 'all'} onClick={() => void saveSetting('filters.agent', 'all')}>
              All
            </button>
            {roster.map((a) => (
              <button key={a.profile} type="button" className="fchip" aria-pressed={agent === a.profile} onClick={() => void saveSetting('filters.agent', a.profile)}>
                <span className="dot" style={{ background: agentColor(a.profile) }} aria-hidden="true" />
                {a.displayName}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="cb sm sk-installbtn"
          aria-expanded={install}
          onClick={() => (install ? closeInstall() : openInstall(agent !== 'all' ? agent : roster.some((a) => a.profile === 'default') ? 'default' : (roster[0]?.profile ?? 'default')))}
        >
          <Icon name="download" size={12} />
          Install from hub
        </button>
      </div>
      {install && <InstallPanel agents={roster} />}
      {status === 'error' && (
        <div className="banner bad" role="alert">
          Can’t list skills: {error} Nothing was changed.
          <button type="button" className="cb sm" onClick={() => void loadSkills()}>
            Retry
          </button>
        </div>
      )}
      {profileErrors.map((p) => (
        <div key={p.profile} className="banner bad" role="alert">
          {names[p.profile] ?? p.profile}: the skills folder is not readable as this SSH user.
        </div>
      ))}
      <div role="tabpanel" id="sk-panel" aria-labelledby={`sk-tab-${tab}`} className="sk-panel">
        {tab === 'changes' ? (
          <ChangesTab profiles={changeProfiles} names={names} />
        ) : (
          <>
            <div className="sk-filters">
              <label className="vh" htmlFor="sk-q">
                Search skills
              </label>
              <input id="sk-q" type="search" className="fld sk-q" autoComplete="off" spellCheck={false} value={q} placeholder="Search name, description, tag" onChange={(e) => setQ(e.target.value)} />
              <div role="group" aria-label="Filter" className="ses-chips">
                {KINDS.map((k) => (
                  <button key={k.id} type="button" className="fchip sk-kind" aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? 'all' : k.id)}>
                    {k.label}
                    <span className="sk-n">{counts[k.id]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="sk-main">
              <section className="sk-listcol" aria-label="Skill list">
                {status === 'loading' || (status === 'idle' && !list) ? (
                  <Skeleton rows={8} />
                ) : rows.length === 0 ? (
                  <EmptyState
                    title={all.length === 0 ? 'No skills yet' : 'No skills match'}
                    why={all.length === 0 ? 'Skills appear when an agent writes one, you install one from the hub, or Hermes ships them.' : 'Clear the search or the filter to see more.'}
                  />
                ) : (
                  <div role="listbox" aria-label="Skills" className="sk-list">
                    {rows.map((s) => {
                      const key = skillKey(s)
                      return (
                        <button key={key} type="button" role="option" aria-selected={key === selected} className="sk-row" onClick={() => void selectSkill(key)}>
                          <span className="sk-row1">
                            {s.pinned && (
                              <span className="sk-pin" title="Pinned" aria-label="pinned">
                                <Icon name="flag" size={11} />
                              </span>
                            )}
                            <span className="sk-rname">
                              {s.category && <span className="sk-cat">{s.category}/</span>}
                              <span className="sk-nm">{s.name}</span>
                            </span>
                            <span className="tag" style={{ color: STATE_COLOR[s.state], borderColor: STATE_COLOR[s.state] }}>
                              {s.state}
                            </span>
                          </span>
                          <span className="sk-rdesc">{s.description}</span>
                          <span className="sk-rmeta">
                            <span style={{ color: agentColor(s.profile), fontWeight: 600 }}>{names[s.profile] ?? s.profile}</span>
                            <span className="tag" style={{ color: ORIGIN_COLOR[s.origin] }}>
                              {ORIGIN_LABEL[s.origin]}
                            </span>
                            <span>
                              {s.useCount} use{s.useCount === 1 ? '' : 's'} · {ago(s.lastUsedAt, now)}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
              <section className="sk-detailcol" aria-label="Skill detail">
                {sel ? (
                  <SkillDetail skill={sel} agentName={names[sel.profile] ?? sel.profile} />
                ) : (
                  <EmptyState title="Pick a skill to read it" why="Agent-written skills are marked, so you can see what an agent taught itself. Hermes has no per-skill enable or disable, and skills from external folders show only in `hermes skills list`." />
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
