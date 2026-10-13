import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
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
    set: (key, value) => ipcRenderer.invoke(IPC.settingsSet, { key, value }),
    reset: () => ipcRenderer.invoke(IPC.settingsReset)
  },
  agents: {
    getPins: () => ipcRenderer.invoke(IPC.pinsGet),
    setPins: (pins) => ipcRenderer.invoke(IPC.pinsSet, pins)
  },
  app: {
    setZoom: (f) => ipcRenderer.invoke(IPC.setZoom, f),
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  cron: {
    action: (req) => ipcRenderer.invoke(IPC.cronAction, req),
    runs: (args) => ipcRenderer.invoke(IPC.cronRuns, args),
    output: (args) => ipcRenderer.invoke(IPC.cronRunOutput, args)
  },
  skills: {
    list: (args) => ipcRenderer.invoke(IPC.skillsList, args),
    read: (args) => ipcRenderer.invoke(IPC.skillRead, args),
    ledger: (args) => ipcRenderer.invoke(IPC.skillsLedger, args),
    blobs: (args) => ipcRenderer.invoke(IPC.skillsBlobs, args),
    action: (req) => ipcRenderer.invoke(IPC.skillsAction, req),
    inspect: (profile, id) => ipcRenderer.invoke(IPC.skillsInspect, { profile, id }),
    curatorStatus: (profile) => ipcRenderer.invoke(IPC.skillsCuratorStatus, profile)
  },
  feed: {
    message: (profile, messageId, field, index) => ipcRenderer.invoke(IPC.feedMessage, { profile, messageId, field, index }),
    history: (before, limit) => ipcRenderer.invoke(IPC.feedHistory, { before, limit }),
    session: (profile, sessionId) => ipcRenderer.invoke(IPC.feedSession, { profile, sessionId })
  },
  interactions: {
    detail: (args) => ipcRenderer.invoke(IPC.interactionDetail, args)
  },
  sessions: {
    list: (args) => ipcRenderer.invoke(IPC.sessionsList, args),
    search: (args) => ipcRenderer.invoke(IPC.sessionsSearch, args),
    transcript: (args) => ipcRenderer.invoke(IPC.sessionsTranscript, args),
    action: (req) => ipcRenderer.invoke(IPC.sessionsAction, req),
    export: (req) => ipcRenderer.invoke(IPC.sessionsExport, req)
  },
  usage: {
    summary: (args) => ipcRenderer.invoke(IPC.usageSummary, args),
    tools: (args) => ipcRenderer.invoke(IPC.usageTools, args)
  },
  logs: {
    list: (args) => ipcRenderer.invoke(IPC.logsList, args),
    read: (args) => ipcRenderer.invoke(IPC.logsRead, args)
  },
  kanban: {
    boards: () => ipcRenderer.invoke(IPC.kanbanBoards),
    tasks: (args) => ipcRenderer.invoke(IPC.kanbanTasks, args),
    task: (args) => ipcRenderer.invoke(IPC.kanbanTask, args)
  },
  gateway: {
    action: (req) => ipcRenderer.invoke(IPC.gatewayAction, req)
  },
  approvals: {
    read: (profile) => ipcRenderer.invoke(IPC.approvalsRead, profile)
  },
  alerts: {
    recheck: () => ipcRenderer.invoke(IPC.alertsRecheck)
  },
  brain: {
    get: () => ipcRenderer.invoke(IPC.brainGet),
    setVault: (path) => ipcRenderer.invoke(IPC.brainSetVault, path),
    validate: (path) => ipcRenderer.invoke(IPC.brainValidate, path),
    browse: (path) => ipcRenderer.invoke(IPC.brainBrowse, path),
    note: (id) => ipcRenderer.invoke(IPC.brainNote, id)
  },
  chat: {
    send: (req) => ipcRenderer.invoke(IPC.chatSend, req),
    stop: (turn) => ipcRenderer.invoke(IPC.chatStop, turn),
    approve: (req) => ipcRenderer.invoke(IPC.chatApprove, req),
    getSession: (profile) => ipcRenderer.invoke(IPC.chatGetSession, profile),
    setSession: (profile, sessionId) => ipcRenderer.invoke(IPC.chatSetSession, { profile, sessionId }),
    sessions: (profile) => ipcRenderer.invoke(IPC.chatSessions, profile),
    pick: () => ipcRenderer.invoke(IPC.chatPick),
    // The path of a dropped file is only known here; the renderer cannot make one up, because a File it builds itself has no path.
    attach: (files) => ipcRenderer.invoke(IPC.chatAttach, files.map((f) => webUtils.getPathForFile(f)).filter((p) => p !== '')),
    detach: (id) => ipcRenderer.invoke(IPC.chatDetach, id),
    backend: (profile) => ipcRenderer.invoke(IPC.chatBackend, profile)
  },
  uploads: {
    list: () => ipcRenderer.invoke(IPC.uploadsList),
    remove: (path) => ipcRenderer.invoke(IPC.uploadsDelete, path),
    cancel: (id) => ipcRenderer.invoke(IPC.uploadsCancel, id)
  },
  agentCfg: {
    readFile: (profile, kind) => ipcRenderer.invoke(IPC.agentFileRead, { profile, kind }),
    writeFile: (req) => ipcRenderer.invoke(IPC.agentFileWrite, req),
    readModel: (profile) => ipcRenderer.invoke(IPC.agentModelRead, profile),
    fetchModels: (req) => ipcRenderer.invoke(IPC.agentModelFetch, req),
    saveModel: (req) => ipcRenderer.invoke(IPC.agentModelSave, req),
    testModel: (profile) => ipcRenderer.invoke(IPC.agentModelTest, profile),
    keyAsArgument: () => ipcRenderer.invoke(IPC.agentKeyMode),
    restartGateway: (profile) => ipcRenderer.invoke(IPC.agentGatewayRestart, profile)
  },
  onEvent: (cb) => on(IPC.evEvent, cb),
  onChat: (cb) => on(IPC.evChat, cb),
  onUpload: (cb) => on(IPC.evUpload, cb),
  onStatus: (cb) => on(IPC.evStatus, cb),
  onStartup: (cb) => on(IPC.evStartup, cb),
  onPreflight: (cb) => on(IPC.evPreflight, cb),
  onCapabilities: (cb) => on(IPC.evCapabilities, cb),
  onModels: (cb) => on(IPC.evModels, cb),
  onOpenCron: (cb) => on(IPC.evOpenCron, cb),
  onCostAlert: (cb) => on(IPC.evCostAlert, cb),
  onOpenUsage: (cb) => on(IPC.evOpenUsage, cb),
  onOpenLogs: (cb) => on(IPC.evOpenLogs, cb)
}

contextBridge.exposeInMainWorld('mc', api)
