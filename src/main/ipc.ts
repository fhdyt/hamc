import { app, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/channels'
import { ConnectRequestSchema, HostKeyChallengeSchema, type AppInfo } from '@shared/ipc'
import { SETTINGS_SCHEMA, isSettingKey } from '@shared/settings'
import { isTrustedSender, type AppTarget } from './security'
import type { MissionSession } from './session'
import type { SettingsStore } from './store/settingsStore'

export interface IpcDeps {
  session: MissionSession
  store: SettingsStore
  getWindow: () => BrowserWindow | null
  target: AppTarget
}

const SetSetting = z.object({ key: z.string(), value: z.unknown() })
const Pins = z.array(z.string().max(128)).max(500)
const Zoom = z.number().min(0.7).max(1.5)

export function registerIpc(d: IpcDeps): void {
  const handle = (channel: string, fn: (arg: unknown) => unknown): void => {
    ipcMain.handle(channel, (event, arg: unknown) => {
      if (!isTrustedSender(event.senderFrame?.url, d.target)) throw new Error('untrusted sender')
      return fn(arg)
    })
  }

  handle(IPC.connect, (a) => d.session.connect(ConnectRequestSchema.parse(a)))
  handle(IPC.trustHostKey, (a) => d.session.trustHostKey(HostKeyChallengeSchema.parse(a)))
  handle(IPC.disconnect, () => d.session.disconnect())
  handle(IPC.forget, () => d.session.forget())
  handle(IPC.saved, () => d.session.getSaved())
  handle(IPC.secretStatus, () => d.session.secretStatus())

  handle(IPC.settingsAll, () => d.store.allSettings())
  handle(IPC.settingsSet, (a) => {
    const { key, value } = SetSetting.parse(a)
    if (!isSettingKey(key)) throw new Error(`unknown setting ${key}`)
    d.store.setSetting(key, (SETTINGS_SCHEMA[key] as { parse(v: unknown): unknown }).parse(value) as never)
  })

  handle(IPC.pinsGet, () => {
    const c = d.store.getConnection()
    return { pins: c ? d.store.getPins(c.id) : [], initialized: c ? d.store.pinsInitialized(c.id) : false }
  })
  handle(IPC.pinsSet, (a) => {
    const c = d.store.getConnection()
    if (c) d.store.setPins(c.id, Pins.parse(a))
  })

  handle(IPC.setZoom, (a) => {
    d.getWindow()?.webContents.setZoomFactor(Zoom.parse(a))
  })
  handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), electron: process.versions.electron ?? '', platform: process.platform }))
}
