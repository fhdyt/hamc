import { useEffect, useRef } from 'react'
import type { Notice } from '@shared/notify'
import { openNoticeTarget } from '../noticeActions'
import { useNotices } from '../stores/notices'
import { useUi } from '../stores/ui'
import { Icon } from './Icon'

const ICON: Record<Notice['kind'], string> = { chat: 'message', cron: 'clock', gateway: 'radio', cost: 'chart', test: 'bell' }
const TONE: Record<Notice['kind'], string> = { chat: '#50FA7B', cron: '#FF5555', gateway: '#FFB86C', cost: '#F1FA8C', test: '#BD93F9' }

export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(at).toLocaleDateString()
}

/** The bell in the status bar with the history of notifications (F-SHELL-4). */
export function NoticeBell() {
  const unread = useNotices((s) => s.unread.length)
  const open = useNotices((s) => s.open)
  const setOpen = useNotices((s) => s.setOpen)
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open, setOpen])
  return (
    <span ref={wrap} style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch' }}>
      <button
        type="button"
        className="sb-item"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen(!open)}
      >
        <Icon name="bell" size={12} />
        {unread > 0 && <span className="nt-count">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <NoticePanel />}
    </span>
  )
}

function NoticePanel() {
  const list = useNotices((s) => s.list)
  const clear = useNotices((s) => s.clear)
  const openSettings = useUi((s) => s.openSettings)
  const setOpen = useNotices((s) => s.setOpen)
  const now = Date.now()
  return (
    <div className="nt-panel" role="dialog" aria-label="Notifications">
      <div className="nt-head">
        <span className="nt-title">Notifications</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          {list.length > 0 && (
            <button type="button" className="cb sm" onClick={clear}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="ib sm"
            aria-label="Notification settings"
            title="Notification settings"
            onClick={() => {
              setOpen(false)
              openSettings('notifications')
            }}
          >
            <Icon name="settings" size={12} />
          </button>
        </span>
      </div>
      {list.length === 0 ? (
        <p className="nt-empty">No notifications yet. Failed cron runs, gateway problems, the daily cost alert and replies that arrive while you look elsewhere show up here.</p>
      ) : (
        <ul className="nt-list" aria-label="Notification history">
          {list.map((n) => (
            <li key={n.id}>
              <button type="button" className="nt-item" disabled={n.target.kind === 'none'} onClick={() => openNoticeTarget(n.target)}>
                <span className="nt-ico" style={{ color: TONE[n.kind] }} aria-hidden="true">
                  <Icon name={ICON[n.kind]} size={12} />
                </span>
                <span className="nt-text">
                  <span className="nt-t">{n.title}</span>
                  {n.body && <span className="nt-b">{n.body}</span>}
                </span>
                <span className="nt-when">{ago(n.at, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Toasts for notices that arrive while the window is in front (the OS shows the others). */
export function Toasts() {
  const toasts = useNotices((s) => s.toasts)
  const list = useNotices((s) => s.list)
  const shown = toasts.flatMap((id) => list.filter((n) => n.id === id))
  if (shown.length === 0) return null
  return (
    <div className="nt-toasts" role="region" aria-label="Recent notifications">
      {shown.map((n) => (
        <Toast key={n.id} n={n} />
      ))}
    </div>
  )
}

function Toast({ n }: { n: Notice }) {
  const dismiss = useNotices((s) => s.dismissToast)
  useEffect(() => {
    const t = window.setTimeout(() => dismiss(n.id), 6000)
    return () => window.clearTimeout(t)
  }, [n.id, dismiss])
  return (
    <div className="nt-toast" role="status" style={{ borderLeftColor: TONE[n.kind] }}>
      <button type="button" className="nt-toast-body" disabled={n.target.kind === 'none'} onClick={() => { dismiss(n.id); openNoticeTarget(n.target) }}>
        <span className="nt-t">{n.title}</span>
        {n.body && <span className="nt-b">{n.body}</span>}
      </button>
      <button type="button" className="ib sm" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
        <Icon name="x" size={11} />
      </button>
    </div>
  )
}
