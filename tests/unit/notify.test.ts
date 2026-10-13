import { describe, expect, it } from 'vitest'
import { IPC } from '@shared/channels'
import { NOTIFY_KINDS_DEFAULT, deliver, desktopBody, inQuietHours, previewText, type Notice, type NotifySettings } from '@shared/notify'
import { NotificationCenter, type OsNotification } from '../../src/main/notify/center'
import { useNotices } from '../../src/renderer/stores/notices'

const base: NotifySettings = { desktop: true, kinds: { ...NOTIFY_KINDS_DEFAULT }, preview: true, sound: true, quiet: { enabled: false, from: '22:00', to: '07:00' } }
const at = (h: number, m = 0): number => h * 60 + m

describe('quiet hours', () => {
  it('handles a range across midnight and one inside the day', () => {
    const night = { enabled: true, from: '22:00', to: '07:00' }
    expect(inQuietHours(night, at(23))).toBe(true)
    expect(inQuietHours(night, at(3))).toBe(true)
    expect(inQuietHours(night, at(7))).toBe(false)
    expect(inQuietHours(night, at(12))).toBe(false)
    const lunch = { enabled: true, from: '12:00', to: '13:30' }
    expect(inQuietHours(lunch, at(12, 45))).toBe(true)
    expect(inQuietHours(lunch, at(13, 30))).toBe(false)
    expect(inQuietHours({ ...night, enabled: false }, at(23))).toBe(false)
    expect(inQuietHours({ enabled: true, from: '25:00', to: '07:00' }, at(23))).toBe(false)
  })
})

describe('deliver', () => {
  it('records every enabled kind; the OS only shows it when the window is not in front', () => {
    expect(deliver('cron', base, { inFront: true, minutes: at(10) })).toEqual({ record: true, desktop: false, sound: false })
    expect(deliver('cron', base, { inFront: false, minutes: at(10) })).toEqual({ record: true, desktop: true, sound: true })
  })
  it('drops a kind that is off, keeps quiet hours silent, and honours the desktop and sound switches', () => {
    expect(deliver('chat', { ...base, kinds: { ...base.kinds, chat: false } }, { inFront: false, minutes: at(10) })).toEqual({ record: false, desktop: false, sound: false })
    const quiet = { ...base, quiet: { enabled: true, from: '22:00', to: '07:00' } }
    expect(deliver('gateway', quiet, { inFront: false, minutes: at(23) })).toEqual({ record: true, desktop: false, sound: false })
    expect(deliver('cost', { ...base, desktop: false }, { inFront: false, minutes: at(10) })).toMatchObject({ record: true, desktop: false })
    expect(deliver('cost', { ...base, sound: false }, { inFront: false, minutes: at(10) })).toMatchObject({ desktop: true, sound: false })
  })
  it('shows a test even in front, without putting it in the bell', () => {
    expect(deliver('test', base, { inFront: true, minutes: at(10) })).toEqual({ record: false, desktop: true, sound: true })
  })
})

describe('texts', () => {
  it('hides the reply in the OS notification when previews are off', () => {
    expect(desktopBody({ kind: 'chat', body: 'secret plan', target: { kind: 'chat', profile: 'scout' } }, false)).not.toContain('secret')
    expect(desktopBody({ kind: 'cron', body: 'job failed', target: { kind: 'none' } }, false)).toBe('job failed')
  })
  it('flattens a markdown reply into one short line', () => {
    expect(previewText('## Done\n**All** good:\n```\nls\n```\n- a')).toBe('Done All good: [code] - a')
    expect(previewText('x'.repeat(300))).toHaveLength(140)
  })
})

describe('NotificationCenter', () => {
  function center(opts: { inFront?: boolean; settings?: Partial<NotifySettings>; os?: boolean } = {}) {
    const sent: [string, unknown][] = []
    const shown: { title: string; body: string; silent: boolean; handlers: Record<string, () => void> }[] = []
    let focused = 0
    const c = new NotificationCenter({
      settings: () => ({ ...base, ...opts.settings }),
      inFront: () => opts.inFront ?? false,
      send: (ch, p) => sent.push([ch, p]),
      focus: () => focused++,
      makeOs:
        opts.os === false
          ? null
          : (o): OsNotification => {
              const rec = { ...o, handlers: {} as Record<string, () => void> }
              shown.push(rec)
              return { on: (e, cb) => (rec.handlers[e] = cb), show: () => undefined }
            },
      now: () => new Date(2026, 9, 13, 10, 0)
    })
    return { c, sent, shown, focused: () => focused }
  }

  it('records a notice, shows it over other apps and opens its target on click', () => {
    const t = center()
    const n = t.c.push({ kind: 'cron', title: 'Cron failed: digest', body: 'scout · boom', target: { kind: 'cron', profile: 'scout', jobId: 'j1' } })
    expect(n).not.toBeNull()
    expect(t.sent[0]![0]).toBe(IPC.evNotice)
    expect(t.shown).toHaveLength(1)
    expect(t.shown[0]).toMatchObject({ title: 'Cron failed: digest', silent: false })
    t.shown[0]!.handlers['click']!()
    expect(t.focused()).toBe(1)
    expect(t.sent[1]).toEqual([IPC.evNoticeOpen, { kind: 'cron', profile: 'scout', jobId: 'j1' }])
  })

  it('cleans control characters and cuts long texts', () => {
    const t = center({ inFront: true })
    const n = t.c.push({ kind: 'chat', title: 'Scout\u0007 replied', body: 'y'.repeat(500), target: { kind: 'chat', profile: 'scout' } })!
    expect(n.title).toBe('Scout replied')
    expect(n.body).toHaveLength(300)
    expect(t.shown).toHaveLength(0)
  })

  it('test explains why nothing was shown', () => {
    expect(center({ os: false }).c.test()).toMatchObject({ shown: false })
    expect(center({ settings: { desktop: false } }).c.test()).toEqual({ shown: false, reason: 'Desktop notifications are turned off.' })
    const t = center({ inFront: true })
    expect(t.c.test()).toEqual({ shown: true })
    expect(t.shown).toHaveLength(1)
    expect(t.sent).toHaveLength(0)
  })
})

describe('notices store', () => {
  const n = (id: string): Notice => ({ id, kind: 'cron', at: 1, title: id, body: '', target: { kind: 'none' } })
  it('keeps the newest first, counts unread until the bell opens, and holds three toasts at most', () => {
    const s = useNotices.getState()
    s.clear()
    for (const id of ['a', 'b', 'c', 'd']) useNotices.getState().add(n(id), true)
    expect(useNotices.getState().list.map((x) => x.id)).toEqual(['d', 'c', 'b', 'a'])
    expect(useNotices.getState().unread).toHaveLength(4)
    expect(useNotices.getState().toasts).toEqual(['d', 'c', 'b'])
    useNotices.getState().setOpen(true)
    expect(useNotices.getState().unread).toEqual([])
    useNotices.getState().add(n('e'), false)
    expect(useNotices.getState().unread).toEqual([])
    useNotices.getState().setOpen(false)
    for (let i = 0; i < 120; i++) useNotices.getState().add(n(`x${i}`), false)
    expect(useNotices.getState().list).toHaveLength(100)
  })
})
