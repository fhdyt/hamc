import { app, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/channels'
import { ConnectRequestSchema, HostKeyChallengeSchema, type AppInfo } from '@shared/ipc'
import { CUSTOM_NAME_RE, CUSTOM_SLUG, EFFORT_RE, FILE_KINDS, MAX_FILE_BYTES, PRESETS, type AgentFileKind } from '@shared/agentCfg'
import { SETTINGS_SCHEMA, isSettingKey } from '@shared/settings'
import { isTrustedSender, type AppTarget } from './security'
import type { MissionSession } from './session'
import type { SettingsStore } from './store/settingsStore'

const ProfileName = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)
const FeedMessageArgs = z.object({
  profile: ProfileName,
  messageId: z.number().int().min(0),
  field: z.enum(['content', 'reasoning', 'tool_calls']),
  index: z.number().int().min(0).optional()
})
const FeedHistoryArgs = z.object({
  before: z.record(ProfileName, z.number().int().min(0)).refine((m) => Object.keys(m).length >= 1 && Object.keys(m).length <= 50),
  limit: z.number().int().min(1).max(100)
})
const FeedSessionArgs = z.object({ profile: ProfileName, sessionId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) })

const InteractionArgs = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), from: ProfileName, to: ProfileName }),
  z.object({ kind: z.literal('kanban'), id: z.number().int().min(0) }),
  z.object({ kind: z.literal('room'), id: z.string().regex(/^room:[^\u0000]{1,80}$/) }),
  z.object({ kind: z.literal('delegate'), id: z.string().regex(/^sub:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9._:-]{1,128}$/) })
])

const VaultPath = z.string().min(1).max(4096).refine((s) => !s.includes('\u0000'))
const BrowsePath = z.string().max(4096).refine((s) => !s.includes('\u0000'))
const NoteId = z.string().min(1).max(4096).refine((s) => !s.includes('\u0000'))

const ChatSendArgs = z.object({
  profile: ProfileName,
  text: z.string().max(100_000),
  attachmentIds: z.array(z.string().regex(/^[A-Za-z0-9-]{8,64}$/)).max(20)
})
const AttachmentId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/)
const SessionId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
const TurnId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/)

const FileKind = z.enum(FILE_KINDS as [AgentFileKind, ...AgentFileKind[]])
const FileReadArgs = z.object({ profile: ProfileName, kind: FileKind })
const FileWriteArgs = z.object({
  profile: ProfileName,
  kind: FileKind,
  text: z.string().max(MAX_FILE_BYTES),
  baseHash: z.string().regex(/^[0-9a-f]{64}$/).nullable()
})
const ProviderSlug = z.enum([CUSTOM_SLUG, ...PRESETS.map((p) => p.slug)] as [string, ...string[]])
const ModelSaveArgs = z.object({
  profile: ProfileName,
  provider: ProviderSlug,
  customName: z.string().regex(CUSTOM_NAME_RE).optional(),
  baseUrl: z.string().max(2048),
  apiKey: z.string().max(4096).optional(),
  model: z.string().min(1).max(200),
  effort: z.string().regex(EFFORT_RE).nullable().optional(),
  writeBaseUrl: z.boolean()
})
const ModelFetchArgs = z.object({ baseUrl: z.string().max(2048), apiKey: z.string().max(4096).optional() })

export interface IpcDeps {
  session: MissionSession
  store: SettingsStore
  getWindow: () => BrowserWindow | null
  target: AppTarget
}

const SetSetting = z.object({ key: z.string(), value: z.unknown() })
const Pins = z.array(z.string().max(128)).max(500)
const Zoom = z.number().min(0.7).max(1.5)
const CronOutputArgs = z.object({ profile: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/), jobId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/) })

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
  handle(IPC.cronOutput, (a) => {
    const { profile, jobId } = CronOutputArgs.parse(a)
    return d.session.cronOutput(profile, jobId)
  })
  handle(IPC.feedMessage, (a) => d.session.feedMessage(FeedMessageArgs.parse(a)))
  handle(IPC.feedHistory, (a) => d.session.feedHistory(FeedHistoryArgs.parse(a)))
  handle(IPC.feedSession, (a) => d.session.feedSession(FeedSessionArgs.parse(a)))
  handle(IPC.interactionDetail, (a) => d.session.interactionDetail(InteractionArgs.parse(a)))
  handle(IPC.brainGet, () => d.session.brainGet())
  handle(IPC.brainSetVault, (a) => d.session.brainSetVault(a === null ? null : VaultPath.parse(a)))
  handle(IPC.brainValidate, (a) => d.session.brainValidate(VaultPath.parse(a)))
  handle(IPC.brainBrowse, (a) => d.session.brainBrowse(BrowsePath.parse(a)))
  handle(IPC.brainNote, (a) => d.session.brainNote(NoteId.parse(a)))
  handle(IPC.chatSend, (a) => d.session.chatSend(ChatSendArgs.parse(a)))
  handle(IPC.chatStop, (a) => d.session.chatStop(TurnId.parse(a)))
  handle(IPC.chatApprove, (a) => d.session.chatApprove(z.object({ turn: TurnId, approval: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/), option: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).nullable() }).parse(a)))
  handle(IPC.chatGetSession, (a) => d.session.chatGetSession(ProfileName.parse(a)))
  handle(IPC.chatSetSession, (a) => {
    const { profile, sessionId } = z.object({ profile: ProfileName, sessionId: SessionId.nullable() }).parse(a)
    d.session.chatSetSession(profile, sessionId)
  })
  handle(IPC.chatPick, () => d.session.chatPick())
  handle(IPC.chatAttach, (a) => d.session.chatAttach(z.array(z.string().min(1).max(4096)).max(20).parse(a)))
  handle(IPC.chatDetach, (a) => d.session.chatDetach(AttachmentId.parse(a)))
  handle(IPC.uploadsCancel, (a) => d.session.uploadsCancel(AttachmentId.parse(a)))
  handle(IPC.uploadsList, () => d.session.uploadsList())
  handle(IPC.uploadsDelete, (a) => d.session.uploadsRemove(z.string().min(1).max(4096).parse(a)))
  handle(IPC.chatSessions, (a) => d.session.chatSessions(ProfileName.parse(a)))
  handle(IPC.chatBackend, (a) => d.session.chatBackend(ProfileName.parse(a)))
  handle(IPC.agentFileRead, (a) => {
    const { profile, kind } = FileReadArgs.parse(a)
    return d.session.agentReadFile(profile, kind)
  })
  handle(IPC.agentFileWrite, (a) => {
    const { profile, kind, text, baseHash } = FileWriteArgs.parse(a)
    return d.session.agentWriteFile(profile, kind, text, baseHash)
  })
  handle(IPC.agentModelRead, (a) => d.session.agentReadModel(ProfileName.parse(a)))
  handle(IPC.agentModelFetch, (a) => d.session.agentFetchModels(ModelFetchArgs.parse(a)))
  handle(IPC.agentModelSave, (a) => d.session.agentSaveModel(ModelSaveArgs.parse(a)))
  handle(IPC.agentModelTest, (a) => d.session.agentTestModel(ProfileName.parse(a)))
  handle(IPC.agentKeyMode, () => d.session.agentKeyAsArgument())
  handle(IPC.agentGatewayRestart, (a) => d.session.agentRestartGateway(ProfileName.parse(a)))
  handle(IPC.appInfo, (): AppInfo => ({ version: app.getVersion(), electron: process.versions.electron ?? '', platform: process.platform }))
}
