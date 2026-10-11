import { useEffect, useRef, useState } from 'react'
import type { ChatSessions } from '@shared/events'
import { resumeSession } from '../../chatActions'
import { Icon } from '../../components/Icon'
import { useChat } from '../../stores/chat'

type Rows = { state: 'loading' } | { state: 'error'; why: string } | { state: 'ok'; sessions: ChatSessions['sessions'] }

const when = (ts: number | null): string => (ts ? new Date(ts * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–')

/** Earlier chats with this agent that were started from Mission Control. Picking one continues it. */
export function HistoryMenu({ profile }: { profile: string }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Rows>({ state: 'loading' })
  const wrap = useRef<HTMLDivElement>(null)
  const current = useChat((s) => s.rooms[profile]?.sessionId ?? null)

  useEffect(() => {
    if (!open) return
    let live = true
    setRows({ state: 'loading' })
    void window.mc.chat.sessions(profile).then((res) => {
      if (!live) return
      setRows(res.ok ? { state: 'ok', sessions: res.data.sessions } : { state: 'error', why: 'The chat history could not be read from the server.' })
    })
    const away = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      live = false
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open, profile])

  return (
    <div className="hm" ref={wrap}>
      <button type="button" className="ib" aria-label="Chat history" aria-expanded={open} aria-haspopup="true" title="History" onClick={() => setOpen(!open)}>
        <Icon name="clock" size={15} />
      </button>
      {open && (
        <div className="hm-pop" role="dialog" aria-label="Chat history">
          {rows.state === 'loading' && <div className="hm-note" role="status">Loading…</div>}
          {rows.state === 'error' && <div className="hm-note" role="alert">{rows.why}</div>}
          {rows.state === 'ok' && rows.sessions.length === 0 && <div className="hm-note" role="status">No chats started from Mission Control yet.</div>}
          {rows.state === 'ok' &&
            rows.sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="hm-row"
                aria-current={s.id === current}
                onClick={() => {
                  setOpen(false)
                  void resumeSession(profile, s.id)
                }}
              >
                <span className="hm-title">{s.title || s.preview || s.id.slice(0, 8)}</span>
                <span className="hm-sub">
                  {when(s.startedAt)} · {s.messages} message{s.messages === 1 ? '' : 's'}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
