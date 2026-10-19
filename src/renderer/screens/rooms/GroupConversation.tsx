import { useLayoutEffect, useMemo, useRef } from 'react'
import { answerGroupApproval, loadEntries } from '../../groupsActions'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { agentColor } from '../../lib/agentColor'
import { clock } from '../../lib/feed'
import { buildGroupConv, quietText, type GroupConv } from '../../lib/groupView'
import { useGroups } from '../../stores/groups'
import { StreamBubble } from '../chat/Conversation'

const NEAR_BOTTOM = 80
const answer = (turn: string, approval: string, option: string | null): void => void answerGroupApproval(turn, approval, option)

function Speaker({ profile, name }: { profile: string; name: string }) {
  return (
    <span className="gr-speaker">
      <Avatar name={name} profile={profile} size={18} />
      <span style={{ color: agentColor(profile) }}>{name}</span>
    </span>
  )
}

function Item({ c, nameOf }: { c: GroupConv; nameOf: (p: string) => string }) {
  switch (c.kind) {
    case 'user':
      return (
        <div className="cv-user-wrap">
          <div className="cv-user" title={clock(c.ts)}>
            {c.text}
          </div>
        </div>
      )
    case 'member':
      return (
        <div className="cv-agent-wrap">
          <Speaker profile={c.profile} name={nameOf(c.profile)} />
          <div className="cv-agent" title={`${nameOf(c.profile)} · ${clock(c.ts)}`}>
            <Markdown text={c.text} />
          </div>
        </div>
      )
    case 'live':
      return (
        <div className="cv-agent-wrap">
          <Speaker profile={c.profile} name={nameOf(c.profile)} />
          <StreamBubble turn={c.turn} showChips onAnswer={answer} />
        </div>
      )
    case 'quiet':
      return <div className="gr-note">{quietText(c.profiles.map(nameOf))}</div>
    case 'failed':
      return (
        <div className="cv-agent-wrap">
          <Speaker profile={c.profile} name={nameOf(c.profile)} />
          <div className="cv-banner bad" role="note">
            <Icon name="alert" size={12} /> {c.text}
          </div>
        </div>
      )
    case 'stopped':
      return (
        <div className="cv-agent-wrap">
          <Speaker profile={c.profile} name={nameOf(c.profile)} />
          {c.text && (
            <div className="cv-agent">
              <Markdown text={c.text} />
            </div>
          )}
          <div className="cv-meta">Stopped</div>
        </div>
      )
    case 'end':
      return (
        <div className={`gr-note ${c.reason === 'error' ? 'bad' : ''}`} role="status">
          {c.text}
        </div>
      )
  }
}

/** A room's log plus the member turn that runs now. */
export function GroupConversation({ id, nameOf }: { id: string; nameOf: (p: string) => string }) {
  const entries = useGroups((s) => s.entries[id])
  const state = useGroups((s) => s.entriesState[id])
  const live = useGroups((s) => s.live[id] ?? null)
  const ended = useGroups((s) => s.ended[id])
  const running = useGroups((s) => !!s.running[id])
  const conv = useMemo(() => buildGroupConv(entries ?? [], live, ended, running), [entries, live, ended, running])
  const box = useRef<HTMLElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [conv, live?.turn.text])
  useLayoutEffect(() => {
    stick.current = true
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [id])

  let body
  if (!entries && state === 'error') body = <ErrorState title="The room could not be opened" onRetry={() => void loadEntries(id)} />
  else if (!entries) body = <Skeleton rows={4} />
  else if (conv.length === 0) body = <EmptyState title="Start the conversation" why="Your message goes to every agent in the room, one after another. Mention @name to ask one of them; agents can pull each other in and ask you with @user." />
  else
    body = conv.map((c) => (
      <div key={c.id} className="cv-item" data-kind={c.kind}>
        <Item c={c} nameOf={nameOf} />
      </div>
    ))

  return (
    <section
      ref={box}
      className="cv"
      aria-label="Room conversation"
      onScroll={() => {
        const el = box.current
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
      }}
    >
      <div className="cv-inner">{body}</div>
    </section>
  )
}
