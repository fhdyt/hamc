import { useEffect, useMemo } from 'react'
import { Avatar } from '../components/Avatar'
import { EmptyState, Skeleton } from '../components/States'
import { agentColor } from '../lib/agentColor'
import { sortAgents } from '../lib/roster'
import { useAgents } from '../stores/agents'
import { useChat } from '../stores/chat'
import { useConn } from '../stores/conn'
import { ChatRoom } from './chat/ChatRoom'
import { STATUS_COLOR, STATUS_LABEL } from './dashboard/AgentDetail'

export function Chat() {
  const agents = useAgents((s) => s.agents)
  const connState = useConn((s) => s.status.state)
  const current = useChat((s) => s.current)
  const setCurrent = useChat((s) => s.setCurrent)
  const rooms = useChat((s) => s.rooms)
  const list = useMemo(() => sortAgents(agents), [agents])
  const selected = list.find((a) => a.profile === current) ?? list[0] ?? null

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
      <aside className="dm-list" aria-label="Agents">
        <div className="dm-title">Direct messages</div>
        {list.map((a) => {
          const r = rooms[a.profile]
          const streaming = !!r && r.turn !== null && !r.turn.ended
          return (
            <button key={a.profile} type="button" className="dm-row" aria-current={selected?.profile === a.profile} onClick={() => setCurrent(a.profile)} title={a.displayName}>
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
      <main className="chat-main">{selected && <ChatRoom key={selected.profile} profile={selected.profile} />}</main>
    </div>
  )
}
