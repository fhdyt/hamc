import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import { NOTICE_BODY_MAX, NOTICE_TITLE_MAX, deliver, desktopBody, type Notice, type NoticeKind, type NoticeTarget, type NotifySettings } from '@shared/notify'

/** The part of Electron's `Notification` the center uses (tests pass a fake). */
export interface OsNotification {
  on(event: 'click' | 'close', cb: () => void): void
  show(): void
}

export interface CenterDeps {
  settings: () => NotifySettings
  /** The window is visible, not minimized and focused. */
  inFront: () => boolean
  send: (channel: string, payload: unknown) => void
  /** Brings the window to the front (show, restore, focus). */
  focus: () => void
  /** Null when the OS has no notifications. */
  makeOs: ((o: { title: string; body: string; silent: boolean }) => OsNotification) | null
  now?: () => Date
}

const clean = (s: string, max: number): string => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max)

/**
 * Every notification of the app goes through here: cron failures, gateway problems, the daily cost, finished chat
 * replies and the test button. It records them for the bell, lets the window show a toast when it is in front, and
 * asks the OS to show them over other apps otherwise (F-R13-4). A click focuses the window and opens what it is about.
 */
export class NotificationCenter {
  /** OS notifications are kept referenced until closed, or the click handler can be garbage collected. */
  private readonly live = new Set<OsNotification>()

  constructor(private readonly d: CenterDeps) {}

  push(input: { kind: NoticeKind; title: string; body: string; target: NoticeTarget }): Notice | null {
    const now = this.d.now?.() ?? new Date()
    const s = this.d.settings()
    const how = deliver(input.kind, s, { inFront: this.d.inFront(), minutes: now.getHours() * 60 + now.getMinutes() })
    const n: Notice = { id: randomUUID(), kind: input.kind, at: now.getTime(), title: clean(input.title, NOTICE_TITLE_MAX), body: clean(input.body, NOTICE_BODY_MAX), target: input.target }
    if (how.record) this.d.send(IPC.evNotice, n)
    if (how.desktop && this.d.makeOs) {
      const os = this.d.makeOs({ title: n.title, body: desktopBody(n, s.preview), silent: !how.sound })
      this.live.add(os)
      os.on('close', () => this.live.delete(os))
      os.on('click', () => {
        this.live.delete(os)
        this.d.focus()
        if (n.target.kind !== 'none') this.d.send(IPC.evNoticeOpen, n.target)
      })
      os.show()
    }
    return how.record || how.desktop ? n : null
  }

  /** The Settings button: one notification the OS shows even while the window is in front. */
  test(): { shown: boolean; reason?: string } {
    if (!this.d.makeOs) return { shown: false, reason: 'This system does not offer desktop notifications.' }
    const s = this.d.settings()
    if (!s.desktop) return { shown: false, reason: 'Desktop notifications are turned off.' }
    const n = this.push({ kind: 'test', title: 'Mission Control', body: 'Notifications appear like this, over other apps.', target: { kind: 'none' } })
    return n ? { shown: true } : { shown: false, reason: 'Quiet hours are on right now.' }
  }
}
