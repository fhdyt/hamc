import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/channels'
import type { MissionApi } from '../shared/ipc'

const on = <T>(channel: string, cb: (v: T) => void): (() => void) => {
  const listener = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: MissionApi = {
  connection: {
    connect: (req) => ipcRenderer.invoke(IPC.connect, req),
    trustHostKey: (c) => ipcRenderer.invoke(IPC.trustHostKey, c),
    disconnect: () => ipcRenderer.invoke(IPC.disconnect),
    forget: () => ipcRenderer.invoke(IPC.forget),
    saved: () => ipcRenderer.invoke(IPC.saved),
    secretStatus: () => ipcRenderer.invoke(IPC.secretStatus)
  },
  settings: {
    all: () => ipcRenderer.invoke(IPC.settingsAll),
    set: (key, value) => ipcRenderer.invoke(IPC.settingsSet, { key, value })
  },
  agents: {
    getPins: () => ipcRenderer.invoke(IPC.pinsGet),
    setPins: (pins) => ipcRenderer.invoke(IPC.pinsSet, pins)
  },
  app: {
    setZoom: (f) => ipcRenderer.invoke(IPC.setZoom, f),
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  onEvent: (cb) => on(IPC.evEvent, cb),
  onStatus: (cb) => on(IPC.evStatus, cb),
  onStartup: (cb) => on(IPC.evStartup, cb),
  onPreflight: (cb) => on(IPC.evPreflight, cb),
  onCapabilities: (cb) => on(IPC.evCapabilities, cb),
  onModels: (cb) => on(IPC.evModels, cb)
}

contextBridge.exposeInMainWorld('mc', api)
