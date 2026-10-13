import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import { updateErrorText, type UpdateState } from '@shared/update'
import { UpdateService, type Updater } from '../../src/main/update/service'
import { updateLine } from '../../src/renderer/stores/update'

class FakeUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = false
  checks = 0
  installs: [boolean | undefined, boolean | undefined][] = []
  next: 'none' | 'found' | 'fail' = 'none'
  async checkForUpdates(): Promise<unknown> {
    this.checks++
    this.emit('checking-for-update')
    if (this.next === 'fail') {
      this.emit('error', new Error('getaddrinfo ENOTFOUND api.github.com'))
      return null
    }
    if (this.next === 'none') this.emit('update-not-available', { version: '0.1.0' })
    else {
      this.emit('update-available', { version: '0.2.0' })
      this.emit('download-progress', { percent: 41.6 })
      this.emit('update-downloaded', { version: '0.2.0' })
    }
    return null
  }
  quitAndInstall(a?: boolean, b?: boolean): void {
    this.installs.push([a, b])
  }
}

function make(opts: { enabled?: boolean; updater?: FakeUpdater | null } = {}) {
  const u = opts.updater === undefined ? new FakeUpdater() : opts.updater
  const sent: UpdateState[] = []
  const svc = new UpdateService({
    updater: u as unknown as Updater | null,
    unsupportedWhy: 'Updates work in the installed app only.',
    current: '0.1.0',
    enabled: () => opts.enabled ?? true,
    send: (ch, p) => {
      if (ch === IPC.evUpdate) sent.push(p as UpdateState)
    },
    now: () => 1000,
    firstDelayMs: 10,
    everyMs: 50
  })
  return { u, svc, sent }
}

afterEach(() => vi.useRealTimers())

describe('UpdateService', () => {
  it('downloads in the background and installs on quit', async () => {
    const { u, svc } = make()
    expect(u!.autoDownload).toBe(true)
    expect(u!.autoInstallOnAppQuit).toBe(true)
    u!.next = 'found'
    const s = await svc.check()
    expect(s).toMatchObject({ phase: 'ready', version: '0.2.0', percent: 100, current: '0.1.0' })
    expect(svc.install()).toBe(true)
    expect(u!.installs).toEqual([[false, true]])
  })

  it('says it is up to date, and refuses Restart to update without a download', async () => {
    const { svc } = make()
    expect(await svc.check()).toMatchObject({ phase: 'none', checkedAt: 1000 })
    expect(svc.install()).toBe(false)
  })

  it('reports a failed check the user asked for, but keeps an automatic one quiet', async () => {
    vi.useFakeTimers()
    const a = make()
    a.u!.next = 'fail'
    a.svc.start()
    await vi.advanceTimersByTimeAsync(15)
    expect(a.u!.checks).toBe(1)
    expect(a.svc.get().phase).toBe('idle')
    expect(await a.svc.check()).toMatchObject({ phase: 'error', message: 'Could not reach GitHub. Check the internet connection.' })
    a.svc.stop()
  })

  it('checks on its own only while the setting is on, and again every interval', async () => {
    vi.useFakeTimers()
    const off = make({ enabled: false })
    off.svc.start()
    await vi.advanceTimersByTimeAsync(200)
    expect(off.u!.checks).toBe(0)
    off.svc.stop()
    const on = make()
    on.svc.start()
    await vi.advanceTimersByTimeAsync(120)
    expect(on.u!.checks).toBeGreaterThanOrEqual(3)
    on.svc.stop()
  })

  it('stops checking once an update is waiting', async () => {
    vi.useFakeTimers()
    const t = make()
    t.u!.next = 'found'
    t.svc.start()
    await vi.advanceTimersByTimeAsync(200)
    expect(t.u!.checks).toBe(1)
    t.svc.stop()
  })

  it('explains why updates do not work in this copy', async () => {
    const { svc } = make({ updater: null })
    expect(svc.get()).toMatchObject({ phase: 'unsupported', message: 'Updates work in the installed app only.' })
    expect((await svc.check()).phase).toBe('unsupported')
    expect(svc.install()).toBe(false)
  })
})

describe('texts', () => {
  it('turns updater errors into short reasons', () => {
    expect(updateErrorText(new Error('HttpError: 404 Not Found\n"method: GET url: https://github.com/fhdyt/hamc/releases/download/v0.2.0/latest.yml"'))).toBe('No published release with update files was found yet.')
    expect(updateErrorText(new Error('New version 0.2.0 is not signed by the application owner'))).toBe('The update is not signed, so the system refused it.')
    expect(updateErrorText(new Error('boom at https://x.io/a/b\nstack'))).toBe('boom at [url]')
  })
  it('describes each phase for the About tab', () => {
    const base: UpdateState = { phase: 'downloading', current: '0.1.0', version: '0.2.0', percent: 40, checkedAt: null, message: null }
    expect(updateLine(base)).toBe('Downloading v0.2.0 · 40%…')
    expect(updateLine({ ...base, phase: 'ready' })).toContain('v0.2.0 is ready')
    expect(updateLine(null)).toContain('Checking how updates work')
  })
})
