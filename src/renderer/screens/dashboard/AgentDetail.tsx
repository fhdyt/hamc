import { openFeedFor } from '../../actions'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { EmptyState } from '../../components/States'
import { useNow } from '../../hooks/useNow'
import { agentColor } from '../../lib/agentColor'
import { formatCost, formatTokens } from '../../lib/feed'
import { formatAge } from '../../lib/format'
import { useAgents } from '../../stores/agents'

export const STATUS_COLOR = { working: '#50FA7B', idle: '#8BE9FD', parked: '#FFB86C', offline: '#8B95BD' } as const
export const STATUS_LABEL = { working: 'WORKING', idle: 'IDLE', parked: 'PARKED', offline: 'OFFLINE' } as const

export function AgentDetail() {
  const selected = useAgents((s) => s.selected)
  const agent = useAgents((s) => s.agents.find((a) => a.profile === selected))
  const model = useAgents((s) => (selected ? s.models[selected] : undefined))
  const now = useNow()

  if (!agent) {
    return <EmptyState title="Select an agent" why="Pick an agent above to chat with it and see its status, model and files." />
  }
  const age = agent.lastActivityTs ? formatAge(Math.max(0, now / 1000 - agent.lastActivityTs)) : 'no activity yet'
  const modelText = model === undefined ? 'reading…' : model === null ? 'unavailable' : [model.provider, model.model].filter(Boolean).join(' · ') || 'unavailable'
  return (
    <div className="detail-card" style={{ borderTopColor: agentColor(agent.profile) }} aria-label={`${agent.displayName} details`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar name={agent.displayName} profile={agent.profile} size={26} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.displayName}</div>
          {agent.displayName !== agent.profile && <div style={{ color: '#8B95BD', fontSize: 11 }}>{agent.profile}</div>}
        </div>
        <span style={{ marginLeft: 'auto', color: STATUS_COLOR[agent.status], fontSize: 10, letterSpacing: 1 }}>{STATUS_LABEL[agent.status]}</span>
      </div>
      <dl className="kv" style={{ margin: 0 }}>
        <dt>model</dt>
        <dd>{modelText}</dd>
        <dt>platforms</dt>
        <dd>{agent.platforms.length ? agent.platforms.map((p) => <span key={p} className="tag" style={{ marginRight: 4 }}>{p}</span>) : '–'}</dd>
        <dt>last activity</dt>
        <dd>{age}</dd>
        <dt>today</dt>
        <dd>
          {agent.stats ? (
            <span aria-label="Today's activity">
              {agent.stats.sessions} session{agent.stats.sessions === 1 ? '' : 's'} · {agent.stats.messages} msg · {agent.stats.toolCalls} tool call{agent.stats.toolCalls === 1 ? '' : 's'}
              <br />
              <span title={`${agent.stats.inputTokens} in · ${agent.stats.outputTokens} out · ${agent.stats.reasoningTokens} reasoning`}>
                {formatTokens(agent.stats.inputTokens)} in · {formatTokens(agent.stats.outputTokens)} out
                {agent.stats.reasoningTokens > 0 ? ` · ${formatTokens(agent.stats.reasoningTokens)} reasoning` : ''} · {formatCost(agent.stats.costUsd)}
              </span>
            </span>
          ) : (
            '–'
          )}
        </dd>
        <dt>files</dt>
        <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {([['SOUL.md', agent.hasSoul], ['MEMORY.md', agent.hasMemory], ['USER.md', agent.hasUser]] as const).map(([n, has]) => (
            <span key={n} className="tag" style={{ opacity: has ? 1 : 0.45 }}>{n}</span>
          ))}
        </dd>
      </dl>
      <button type="button" className="cb" onClick={() => openFeedFor(agent.profile)}>
        <Icon name="activity" size={12} /> Open feed
      </button>
    </div>
  )
}
