import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { answerApproval, loadHistory } from '../../chatActions'
import { Icon } from '../../components/Icon'
import { Markdown } from '../../components/Markdown'
import { EmptyState, ErrorState, Skeleton } from '../../components/States'
import { buildConversation, callArgs, chipText, formatDuration, sessionItems, type ApprovalCard, type Conv, type ToolChip, type Turn } from '../../lib/chat'
import { clock } from '../../lib/feed'
import { emptyRoom, useChat } from '../../stores/chat'
import { useFeed } from '../../stores/feed'

const EMPTY = emptyRoom()
const NEAR_BOTTOM = 80

function Chip({ chip }: { chip: ToolChip }) {
  return (
    <span className={`cv-chip ${chip.state}`} role="status" aria-label={chipText(chip)}>
      <Icon name="tool" size={11} /> {chipText(chip)}
    </span>
  )
}

function Approval({ turn, a }: { turn: string; a: ApprovalCard }) {
  const pending = a.state === 'pending'
  const label = a.state === 'allowed' ? `Allowed${a.choice ? `: ${a.choice}` : ''}` : a.state === 'denied' ? `Denied${a.choice ? `: ${a.choice}` : ''}` : a.state === 'cancelled' ? 'Not answered' : ''
  return (
    <div className={`cv-approval ${a.state}`} role="group" aria-label={`Approval: ${a.title}`}>
      <div className="cv-approval-head">
        <Icon name="shield" size={13} /> <strong>{pending ? 'Hermes asks for your approval' : 'Approval'}</strong>
      </div>
      <div className="cv-approval-title">{a.title}</div>
      {a.detail && <code className="cv-code">{a.detail}</code>}
      {pending ? (
        <div className="cv-approval-actions">
          {a.options.map((o) => (
            <button key={o.id} type="button" className={`cb ${o.kind === 'allow' ? 'pri' : 'dng'}`} onClick={() => void answerApproval(turn, a.id, o.id)}>
              {o.name}
            </button>
          ))}
        </div>
      ) : (
        <div className="cv-meta" role="status">
          {label}
        </div>
      )}
    </div>
  )
}

function Foldout({ label, color, children }: { label: string; color: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="cv-fold">
      <button type="button" className="cv-fold-btn" aria-expanded={open} onClick={() => setOpen(!open)} style={{ color, borderColor: color }}>
        <Icon name={open ? 'chev-down' : 'chev-right'} size={12} /> {label}
      </button>
      {open && <div className="cv-fold-body">{children}</div>}
    </div>
  )
}

function StreamBubble({ turn, showChips }: { turn: Turn; showChips: boolean }) {
  const waiting = !turn.ended && turn.text === '' && !turn.approvals.some((a) => a.state === 'pending')
  const stats = [
    turn.result?.durationMs !== undefined ? formatDuration(turn.result.durationMs) : null,
    turn.result?.inputTokens !== undefined ? `${turn.result.inputTokens} in` : null,
    turn.result?.outputTokens !== undefined ? `${turn.result.outputTokens} out` : null
  ].filter(Boolean)
  return (
    <div className="cv-agent-wrap">
      {turn.note && (
        <div className="cv-note" role="note">
          {turn.note}
        </div>
      )}
      {showChips && turn.tools.length > 0 && (
        <div className="cv-chips">
          {turn.tools.map((t) => (
            <Chip key={t.id} chip={t} />
          ))}
        </div>
      )}
      {turn.approvals.map((a) => (
        <Approval key={a.id} turn={turn.id} a={a} />
      ))}
      {turn.notice && (
        <div className="cv-banner warn" role="status">
          <Icon name="shield" size={12} /> {turn.notice}
        </div>
      )}
      {waiting && (
        <div className="cv-typing" role="status" aria-label="The agent is typing">
          <span className="mc-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          working
        </div>
      )}
      {turn.text !== '' && (
        <div className="cv-agent">
          <Markdown text={turn.text} />
        </div>
      )}
      {turn.error && (
        <div className="cv-banner bad" role="alert">
          <Icon name="alert" size={12} /> {turn.error}
        </div>
      )}
      {turn.ended && turn.stopped && <div className="cv-meta">Stopped</div>}
      {turn.ended && !turn.stopped && stats.length > 0 && <div className="cv-meta">{stats.join(' · ')}</div>}
    </div>
  )
}

function Item({ c, name }: { c: Conv; name: string }) {
  switch (c.kind) {
    case 'user':
      return (
        <div className="cv-user-wrap">
          {(c.attachments.length > 0 || (c.thumbs?.length ?? 0) > 0) && (
            <div className="cv-files">
              {c.thumbs?.map((t) => (
                <span key={t.name} className="cv-file" title={t.name}>
                  {t.thumb ? <img src={t.thumb} alt="" /> : <Icon name="paperclip" size={11} />} {t.name}
                </span>
              ))}
              {c.attachments.map((a) => (
                <span key={a.path} className="cv-file" title={`${a.path} · ${a.info}`}>
                  <Icon name="paperclip" size={11} /> {a.name} <em>{a.info}</em>
                </span>
              ))}
            </div>
          )}
          {c.text && (
            <div className="cv-user" title={clock(c.ts)} style={c.pending ? { opacity: 0.7 } : undefined}>
              {c.text}
            </div>
          )}
        </div>
      )
    case 'thinking':
      return (
        <Foldout label="Thinking" color="#8BE9FD">
          <p className="cv-think">{c.text}</p>
        </Foldout>
      )
    case 'tool':
      return (
        <Foldout label={`${c.name}${c.result !== undefined ? ' ✓' : '…'}`} color="#FFB86C">
          <code className="cv-code">{callArgs(c.call, c.name)}</code>
          {c.result !== undefined && <code className="cv-code res">{c.result}</code>}
        </Foldout>
      )
    case 'reply':
      return (
        <div className="cv-agent-wrap">
          <div className="cv-agent" title={`${name} · ${clock(c.ts)}`}>
            <Markdown text={c.text} />
          </div>
        </div>
      )
    case 'stream':
      return <StreamBubble turn={c.turn} showChips={c.showChips} />
  }
}

/** The conversation with one agent: saved messages from the server database plus the reply that is being written. */
export function Conversation({ profile, name, compact = false }: { profile: string; name: string; compact?: boolean }) {
  const room = useChat((s) => s.rooms[profile]) ?? EMPTY
  const live = useFeed((s) => s.items)
  const items = useMemo(() => sessionItems(room.history, live, profile, room.sessionId), [room.history, live, profile, room.sessionId])
  const conv = useMemo(() => buildConversation(items, room.pending, room.turn), [items, room.pending, room.turn])
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const onScroll = (): void => {
    const el = box.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
  }
  useLayoutEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [conv, room.turn?.text])
  // a different agent or session starts at the bottom
  useLayoutEffect(() => {
    stick.current = true
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [profile, room.sessionId])

  let body
  if (room.historyState === 'loading' && conv.length === 0) body = <Skeleton rows={4} />
  else if (room.historyState === 'error' && conv.length === 0) body = <ErrorState title="The conversation could not be opened" why={room.historyError ?? undefined} onRetry={() => void loadHistory(profile)} />
  else if (conv.length === 0) body = <EmptyState title={`Say hello to ${name}`} why="Messages go to the agent through Hermes on your server. Its replies, tool steps and thinking show up here." />
  else
    body = conv.map((c) => (
      <div key={c.id} className="cv-item" data-kind={c.kind}>
        <Item c={c} name={name} />
      </div>
    ))

  return (
    <section ref={box} className={`cv ${compact ? 'compact' : ''}`} aria-label="Conversation" onScroll={onScroll}>
      <div className="cv-inner">{body}</div>
    </section>
  )
}
