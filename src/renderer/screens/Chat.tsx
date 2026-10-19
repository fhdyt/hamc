import { useEffect, useMemo, useState } from 'react'
import { openDm, openGroup } from '../groupsActions'
import { Icon } from '../components/Icon'
import { roomSub } from '../lib/groupView'
import { roomKey } from '../lib/unread'
import { useGroups } from '../stores/groups'
import { useUnread } from '../stores/unread'
import { GroupDialog } from './rooms/GroupDialog'
import { GroupRoom } from './rooms/GroupRoom'
import { Avatar } from '../components/Avatar'
import { EmptyState, Skeleton } from '../components/States'
import { agentColor } from '../lib/agentColor'
import { sortAgents } from '../lib/roster'
import { useAgents } from '../stores/agents'
import { useChat } from '../stores/chat'
import { useConn } from '../stores/conn'
import { ChatRoom } from './chat/ChatRoom'
import { ActivityPanel } from './dashboard/ActivityPanel'
import { STATUS_COLOR, STATUS_LABEL } from './dashboard/AgentDetail'

export function Chat() {
  const agents = useAgents((s) => s.agents)
  const connState = useConn((s) => s.status.state)
  const current = useChat((s) => s.current)
  const setCurrent = useChat((s) => s.setCurrent)
  const rooms = useChat((s) => s.rooms)
  const list = useMemo(() => sortAgents(agents), [agents])
  const selected = list.find((a) => a.profile === current) ?? list[0] ?? null
  const groups = useGroups((s) => s.rooms)
  const groupRunning = useGroups((s) => s.running)
  const roomId = useGroups((s) => s.current)
  const unread = useUnread((s) => s.counts)
  const [creating, setCreating] = useState(false)
  const openRoom = roomId !== null && groups.some((g) => g.id === roomId) ? roomId : null

  useEffect(() => {
    if (selected && selected.profile !== current) setCurrent(selected.profile)
  }, [selected, current, setCurrent])

  if (agents.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Chat</h1>
        {connState === 'connected' ? <Skeleton rows={4} /> : <EmptyState title="No agents yet" why="Agents appear after the first successful connection. Then you can chat with them here." />}
      </div>
    )
  }

  return (
    <div className="chat-screen">
      <aside className="dm-list" aria-label="Rooms and agents">
        <div className="dm-title gr-list-title">
          <span>Rooms</span>
          <button type="button" className="ib sm" onClick={() => setCreating(true)} aria-label="New room" title="New room: you and 2 to 6 agents" disabled={list.length < 2}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        {groups.length === 0 && <div className="gr-empty">{list.length < 2 ? 'Rooms need at least two agents.' : 'Talk to several agents at once.'}</div>}
        {groups.map((g) => {
          const sub = roomSub(g, !!groupRunning[g.id], unread[roomKey(g.id)] ?? 0)
          return (
            <button key={g.id} type="button" className={`dm-row gr-row ${g.needsYou ? 'needs' : ''}`} aria-current={openRoom === g.id} onClick={() => openGroup(g.id)} title={g.name}>
              <span className="gr-stack" aria-hidden="true">
                {g.members.slice(0, 3).map((p) => (
                  <Avatar key={p} name={list.find((a) => a.profile === p)?.displayName ?? p} profile={p} size={18} />
                ))}
              </span>
              <span className="dm-text">
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                <span className="dm-sub">{sub}</span>
              </span>
            </button>
          )
        })}
        <div className="dm-title">Direct messages</div>
        {list.map((a) => {
          const r = rooms[a.profile]
          const streaming = !!r && r.turn !== null && !r.turn.ended
          return (
            <button key={a.profile} type="button" className="dm-row" aria-current={openRoom === null && selected?.profile === a.profile} onClick={() => openDm(a.profile)} title={a.displayName}>
              <span style={{ position: 'relative', display: 'flex' }}>
                <Avatar name={a.displayName} profile={a.profile} size={28} />
                <span className="dot" style={{ position: 'absolute', right: -1, bottom: -1, width: 8, height: 8, border: '2px solid #282A36', background: STATUS_COLOR[a.status] }} />
              </span>
              <span className="dm-text">
                <span style={{ color: agentColor(a.profile), fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.displayName}</span>
                <span className="dm-sub">{streaming ? 'streaming…' : STATUS_LABEL[a.status].toLowerCase()}</span>
              </span>
            </button>
          )
        })}
      </aside>
      {openRoom ? (
        <GroupRoom key={openRoom} id={openRoom} />
      ) : (
        <>
          <main className="chat-main">{selected && <ChatRoom key={selected.profile} profile={selected.profile} />}</main>
          {selected && (
            <aside className="chat-activity" aria-label={`Activity of ${selected.displayName}`}>
              <ActivityPanel key={selected.profile} profile={selected.profile} style={{ flex: 1, minHeight: 0 }} />
            </aside>
          )}
        </>
      )}
      {creating && <GroupDialog room={null} onClose={() => setCreating(false)} />}
    </div>
  )
}
