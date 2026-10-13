import { app, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/channels'
import { ConnectRequestSchema, HostKeyChallengeSchema, type AppInfo } from '@shared/ipc'
import { CUSTOM_NAME_RE, CUSTOM_SLUG, EFFORT_RE, FILE_KINDS, MAX_FILE_BYTES, PRESETS, type AgentFileKind } from '@shared/agentCfg'
import { SETTINGS_SCHEMA, isSettingKey } from '@shared/settings'
import { LOG_FILES } from '@shared/logs'
import { BOARD_RE, TASK_ID_RE } from '@shared/kanban'
import { EXPORT_MAX_BYTES } from './sessions/export'
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
  z.object({ kind: z.literal('kanban'), id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/) }),
  z.object({ kind: z.literal('room'), id: z.string().regex(/^room:[^\u0000]{1,80}$/) }),
  z.object({ kind: z.literal('delegate'), id: z.string().regex(/^sub:[A-Za-z0-9._-]{1,64}:[A-Za-z0-9._:-]{1,128}$/) })
])

const KanbanBoardArg = z.string().regex(BOARD_RE)
const KanbanTasksSchema = z.object({ board: KanbanBoardArg })
const KanbanTaskSchema = z.object({ board: KanbanBoardArg, id: z.string().regex(TASK_ID_RE) })

const SessionIdArg = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
const SessionFilter = {
  profiles: z.array(ProfileName).max(50),
  source: z.string().min(1).max(64).optional(),
  sinceTs: z.number().finite().optional()
}
const SessionsListSchema = z.object({
  ...SessionFilter,
  before: z.object({ ts: z.number().finite().nullable(), id: SessionIdArg }).optional(),
  limit: z.number().int().min(1).max(100)
})
const SessionsSearchSchema = z.object({ ...SessionFilter, q: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(200) })
const TranscriptSchema = z.object({ profile: ProfileName, sessionId: SessionIdArg, afterId: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200) })

const SessionActionSchema = z.object({
  action: z.enum(['pin', 'unpin', 'rename']),
  profile: ProfileName,
  sessionId: SessionIdArg,
  title: z.string().max(200).optional()
})
const ExportSchema = z.object({ name: z.string().min(1).max(200), ext: z.enum(['jsonl', 'md', 'html']), content: z.string().max(EXPORT_MAX_BYTES) })

const DaySpan = (a: number[], end: number): boolean => end - a[a.length - 1]! >= 82800 && end - a[a.length - 1]! <= 90000
const UsageSummarySchema = z
  .object({
    profiles: z.array(ProfileName).max(50),
    dayStarts: z
      .array(z.number().finite())
      .min(1)
      .max(31)
      .refine((a) => a.every((v, i) => i === 0 || (v - a[i - 1]! >= 82800 && v - a[i - 1]! <= 90000))),
    endTs: z.number().finite()
  })
  .refine((a) => DaySpan(a.dayStarts, a.endTs))
const UsageToolsSchema = z.object({ profiles: z.array(ProfileName).max(50), sinceTs: z.number().finite(), endTs: z.number().finite() }).refine((a) => a.endTs > a.sinceTs)

const LogsListSchema = z.object({ profiles: z.array(ProfileName).max(50) })
const LogsReadSchema = z.object({
  profile: ProfileName,
  file: z.enum(LOG_FILES),
  after: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(2000)
})
const GatewayActionSchema = z.object({ action: z.enum(['restart', 'stop']), profile: ProfileName })

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
  handle(IPC.settingsReset, () => d.store.resetSettings())
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
  handle(IPC.sessionsList, (a) => d.session.sessionsList(SessionsListSchema.parse(a)))
  handle(IPC.sessionsSearch, (a) => d.session.sessionsSearch(SessionsSearchSchema.parse(a)))
  handle(IPC.sessionsTranscript, (a) => d.session.sessionsTranscript(TranscriptSchema.parse(a)))
  handle(IPC.sessionsAction, (a) => d.session.sessionAction(SessionActionSchema.parse(a)))
  handle(IPC.sessionsExport, (a) => d.session.sessionExport(ExportSchema.parse(a), d.getWindow()))
  handle(IPC.logsList, (a) => d.session.logsList(LogsListSchema.parse(a)))
  handle(IPC.logsRead, (a) => d.session.logsRead(LogsReadSchema.parse(a)))
  handle(IPC.kanbanBoards, () => d.session.kanbanBoards())
  handle(IPC.kanbanTasks, (a) => d.session.kanbanTasks(KanbanTasksSchema.parse(a)))
  handle(IPC.kanbanTask, (a) => d.session.kanbanTask(KanbanTaskSchema.parse(a)))
  handle(IPC.gatewayAction, (a) => d.session.gatewayAction(GatewayActionSchema.parse(a)))
  handle(IPC.approvalsRead, (a) => d.session.approvalsRead(ProfileName.parse(a)))
  handle(IPC.alertsRecheck, () => d.session.alertsRecheck())
  handle(IPC.usageSummary, (a) => d.session.usageSummary(UsageSummarySchema.parse(a)))
  handle(IPC.usageTools, (a) => d.session.usageTools(UsageToolsSchema.parse(a)))
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
