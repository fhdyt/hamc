import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GroupMember } from '@shared/groups'
import { deleteGroup, openDm } from '../../groupsActions'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { agentColor } from '../../lib/agentColor'
import { useAgents } from '../../stores/agents'
import { useGroups } from '../../stores/groups'
import { STATUS_COLOR, STATUS_LABEL } from '../dashboard/AgentDetail'
import { GroupComposer } from './GroupComposer'
import { GroupConversation } from './GroupConversation'
import { GroupDialog } from './GroupDialog'

/** One group chat room in the Chat screen: header, conversation, message box, and the members on the right. */
export function GroupRoom({ id }: { id: string }) {
  const room = useGroups((s) => s.rooms.find((r) => r.id === id) ?? null)
  const running = useGroups((s) => !!s.running[id])
  const gateway = useGroups((s) => s.gateway)
  const agents = useAgents((s) => s.agents)
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const nameOf = useCallback((p: string): string => agents.find((a) => a.profile === p)?.displayName ?? p, [agents])
  const members: GroupMember[] = useMemo(() => (room?.members ?? []).map((p) => ({ profile: p, name: nameOf(p) })), [room, nameOf])

  useEffect(() => setConfirm(false), [id])
  if (!room) return null

  return (
    <>
      <main className="chat-main">
        <div className="cr">
          <div className="cr-head">
            <h1 className="gr-title">
              <Icon name="users" size={15} /> {room.name}
            </h1>
            <span className="gr-faces" aria-label={`Agents: ${members.map((m) => m.name).join(', ')}`}>
              {members.map((m) => (
                <Avatar key={m.profile} name={m.name} profile={m.profile} size={22} />
              ))}
            </span>
            <span className="cr-session">{running ? 'agents are answering…' : `${members.length} agents · room on this computer`}</span>
            <div className="cr-actions">
              <button type="button" className="cb" onClick={() => setEditing(true)} title="Rename the room or change its agents">
                <Icon name="edit" size={13} /> Edit
              </button>
              {confirm ? (
                <>
                  <button type="button" className="cb dng" onClick={() => void deleteGroup(id)} title="The room and its messages go; the agents' room sessions stay on the server">
                    Delete for good
                  </button>
                  <button type="button" className="cb" onClick={() => setConfirm(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" className="cb" onClick={() => setConfirm(true)} disabled={running} aria-label="Delete room" title="Delete this room">
                  <Icon name="trash" size={13} /> Delete
                </button>
              )}
            </div>
          </div>
          <GroupConversation id={id} nameOf={nameOf} />
          <GroupComposer id={id} name={room.name} members={members} disabled={gateway.ok ? null : (gateway.reason ?? 'Rooms need the Hermes TUI gateway.')} />
        </div>
      </main>
      <aside className="chat-activity gr-side" aria-label={`Agents in ${room.name}`}>
        <div className="gr-side-title">In this room</div>
        {members.map((m) => {
          const a = agents.find((x) => x.profile === m.profile)
          return (
            <div key={m.profile} className="gr-member">
              <span style={{ position: 'relative', display: 'flex' }}>
                <Avatar name={m.name} profile={m.profile} size={26} />
                {a && <span className="dot" style={{ position: 'absolute', right: -1, bottom: -1, width: 8, height: 8, border: '2px solid #282A36', background: STATUS_COLOR[a.status] }} />}
              </span>
              <span className="dm-text">
                <span style={{ color: agentColor(m.profile), fontWeight: 600 }}>{m.name}</span>
                <span className="dm-sub">{a ? `@${m.profile} · ${STATUS_LABEL[a.status].toLowerCase()}` : 'not on the server'}</span>
              </span>
              {a && (
                <button type="button" className="ib sm" onClick={() => openDm(m.profile)} aria-label={`Open the chat with ${m.name}`} title="Open the 1:1 chat">
                  <Icon name="message" size={13} />
                </button>
              )}
            </div>
          )
        })}
        {room.needsYou && (
          <div className="cv-banner warn" role="status">
            <Icon name="flag" size={12} /> An agent asked you something in the last round.
          </div>
        )}
      </aside>
      {editing && <GroupDialog room={room} onClose={() => setEditing(false)} />}
    </>
  )
}
