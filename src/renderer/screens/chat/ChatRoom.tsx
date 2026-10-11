import { useEffect, type ReactNode } from 'react'
import { newChat, openRoom } from '../../chatActions'
import { Icon } from '../../components/Icon'
import { agentColor } from '../../lib/agentColor'
import { useAgents } from '../../stores/agents'
import { isBusy, useChat } from '../../stores/chat'
import { Composer } from './Composer'
import { Conversation } from './Conversation'
import { HistoryMenu } from './HistoryMenu'

/** The header, conversation and message box for one agent. Used by the Chat screen and inside the Dashboard agents panel. */
export function ChatRoom({ profile, compact = false, extra }: { profile: string; compact?: boolean; extra?: ReactNode }) {
  const agent = useAgents((s) => s.agents.find((a) => a.profile === profile))
  const model = useAgents((s) => s.models[profile])
  const sessionId = useChat((s) => s.rooms[profile]?.sessionId ?? null)
  const busy = useChat((s) => isBusy(s.rooms[profile]))
  const name = agent?.displayName ?? profile
  const modelText = model ? [model.provider, model.model].filter(Boolean).join(' · ') : ''

  useEffect(() => {
    void openRoom(profile)
  }, [profile])

  return (
    <div className={`cr ${compact ? 'compact' : ''}`}>
      <div className="cr-head">
        <h1 style={{ color: agentColor(profile) }}>@{name}</h1>
        {!compact && modelText && <span className="cr-model">{modelText}</span>}
        {!compact && <span className="cr-session">{sessionId ? `session ${sessionId.slice(0, 8)} · source mission-control` : 'new chat'}</span>}
        <div className="cr-actions">
          {extra}
          <HistoryMenu profile={profile} />
          <button type="button" className="ib" aria-label="New chat" title="New chat" disabled={busy} onClick={() => void newChat(profile)}>
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
      <Conversation profile={profile} name={name} compact={compact} />
      <Composer profile={profile} name={name} />
    </div>
  )
}
