import { useEffect, useMemo } from 'react'
import { FILE_LABEL } from '@shared/agentCfg'
import { Avatar } from '../../components/Avatar'
import { EmptyState } from '../../components/States'
import { useAgents } from '../../stores/agents'
import { unsavedKinds, useAgentCfg, type AgentTab } from '../../stores/agentCfg'
import { FileEditor } from './FileEditor'
import { ModelTab } from './ModelTab'
import { ProfileTab } from './ProfileTab'
import { NewProfileDialog } from './NewProfile'
import { BackupTab, FallbackTab, McpTab, ToolsetsTab } from './OpsTabs'
import { Icon } from '../../components/Icon'
import { useAgentOps } from '../../stores/agentOps'

const TABS: { id: AgentTab; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'model', label: 'Model' },
  { id: 'soul', label: FILE_LABEL.soul },
  { id: 'memory', label: 'Memory' },
  { id: 'user', label: 'User profile' },
  { id: 'mcp', label: 'MCP' },
  { id: 'toolsets', label: 'Toolsets' },
  { id: 'fallback', label: 'Fallback' },
  { id: 'backup', label: 'Backup' }
]

/** Settings → Agents: the agent list on the left, the tabs Profile, Model, Soul, Memory, User profile and the agent tools on the right (PRD 6.8). */
export function AgentsSettings() {
  const agents = useAgents((s) => s.agents)
  const selected = useAgents((s) => s.selected)
  const profile = useAgentCfg((s) => s.profile)
  const tab = useAgentCfg((s) => s.tab)
  const select = useAgentCfg((s) => s.selectProfile)
  const setTab = useAgentCfg((s) => s.setTab)
  const requestLeave = useAgentCfg((s) => s.requestLeave)
  const drafts = useAgentCfg((s) => s.drafts)
  const modelDirty = useAgentCfg((s) => s.modelDirty)
  const dirty = useMemo(() => (profile ? unsavedKinds({ drafts, modelDirty }, profile) : new Set<AgentTab>()), [drafts, modelDirty, profile])

  // Opens on the agent that is selected on the Dashboard, else the first one.
  useEffect(() => {
    if (profile && agents.some((a) => a.profile === profile)) return
    const first = (selected && agents.find((a) => a.profile === selected)?.profile) ?? agents[0]?.profile ?? null
    if (first !== profile) select(first)
  }, [agents, selected, profile, select])

  if (agents.length === 0) return <EmptyState title="No agents yet" why="Connect to a server with Hermes profiles to change their model, soul and memory." />
  const current = agents.find((a) => a.profile === profile)

  return (
    <div className="ag-wrap">
      <div className="ag-list" role="group" aria-label="Agents">
        {agents.map((a) => (
          <button
            key={a.profile}
            type="button"
            className="ag-item"
            aria-pressed={a.profile === profile}
            onClick={() => {
              if (a.profile !== profile) requestLeave(`Switching to ${a.displayName} drops the unsaved changes of ${current?.displayName ?? 'this agent'}.`, () => select(a.profile), profile ?? undefined)
            }}
          >
            <Avatar name={a.displayName} profile={a.profile} size={22} />
            <span className="nm">{a.displayName}</span>
          </button>
        ))}
        <button type="button" className="ag-item ag-new" onClick={() => useAgentOps.getState().set({ newProfile: { ...useAgentOps.getState().newProfile, open: true, result: null } })}>
          <Icon name="plus" size={14} />
          <span className="nm">New profile</span>
        </button>
      </div>
      <NewProfileDialog />
      <div className="ag-main">
        {current && (
          <>
            <div role="tablist" aria-label="Agent settings" className="ag-tabs">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" id={`agtab-${t.id}`} aria-selected={tab === t.id} aria-controls="agpanel" className="ag-tab" onClick={() => setTab(t.id)}>
                  {t.label}
                  {dirty.has(t.id) && <span className="dot" style={{ background: '#FFB86C' }} aria-label="unsaved" />}
                </button>
              ))}
            </div>
            <div role="tabpanel" id="agpanel" aria-labelledby={`agtab-${tab}`} key={`${current.profile}:${tab}`}>
              {tab === 'profile' ? (
                <ProfileTab profile={current.profile} />
              ) : tab === 'model' ? (
                <ModelTab profile={current.profile} />
              ) : tab === 'mcp' ? (
                <McpTab profile={current.profile} />
              ) : tab === 'toolsets' ? (
                <ToolsetsTab profile={current.profile} />
              ) : tab === 'fallback' ? (
                <FallbackTab profile={current.profile} />
              ) : tab === 'backup' ? (
                <BackupTab profile={current.profile} />
              ) : (
                <FileEditor profile={current.profile} kind={tab} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
