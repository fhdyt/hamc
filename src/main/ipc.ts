import { app, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/channels'
import { ConnectRequestSchema, HostKeyChallengeSchema, type AppInfo } from '@shared/ipc'
import { CUSTOM_NAME_RE, CUSTOM_SLUG, EFFORT_RE, FILE_KINDS, MAX_FILE_BYTES, PRESETS, type AgentFileKind } from '@shared/agentCfg'
import { SETTINGS_SCHEMA, isSettingKey } from '@shared/settings'
import { LOG_FILES } from '@shared/logs'
import { BOARD_RE, TASK_ID_RE } from '@shared/kanban'
import { CRON_ACTIONS, INCIDENT_ID_RE, JOB_ID_RE, SCHEDULE_MAX } from '@shared/cron'
import { DESCRIPTION_MAX, MCP_NAME_RE, NEW_PROFILE_RE, PLATFORM_RE, TOOLSET_RE } from '@shared/agentOps'
import { TERM_COLS, TERM_ID_RE, TERM_ROWS, TERM_WRITE_MAX } from '@shared/terminal'
import { CATEGORY_RE, SHA_RE, SKILL_ACTIONS, SKILL_NAME_RE, validHubId, validSkillPath } from '@shared/skills'
import { EXPORT_MAX_BYTES } from './sessions/export'
import { isTrustedSender, type AppTarget } from './security'
import type { MissionSession } from './session'
import type { SettingsStore } from './store/settingsStore'
import type { NotificationCenter } from './notify/center'
import type { UpdateService } from './update/service'
import { NOTICE_BODY_MAX, NOTICE_TITLE_MAX } from '@shared/notify'

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
  /** Notifications (F-SHELL-4); the test button and finished chat replies. */
  center?: NotificationCenter
  /** Auto-update (F-APP-6). */
  updates?: UpdateService
  /** A setting that the main process must act on (tray, login item) changed. */
  onSetting?: (key: string, value: unknown) => void
}

const SetSetting = z.object({ key: z.string(), value: z.unknown() })
const Pins = z.array(z.string().max(128)).max(500)
const Zoom = z.number().min(0.7).max(1.5)
const JobId = z.string().regex(JOB_ID_RE).refine((s) => s !== '.' && s !== '..')
const CronActionSchema = z.object({
  action: z.enum(CRON_ACTIONS),
  profile: ProfileName,
  jobId: JobId,
  schedule: z.string().max(SCHEDULE_MAX).optional(),
  incidentId: z.string().regex(INCIDENT_ID_RE).optional()
})
const CronRunsSchema = z.object({ profile: ProfileName, jobId: JobId, limit: z.number().int().min(1).max(20) })
const HubId = z.string().max(320).refine(validHubId)
const SkillActionSchema = z.object({
  action: z.enum(SKILL_ACTIONS),
  profile: ProfileName,
  name: z.string().regex(SKILL_NAME_RE).optional(),
  id: HubId.optional(),
  category: z.string().regex(CATEGORY_RE).optional()
})
const SkillsListSchema = z.object({ profiles: z.array(ProfileName).max(50) })
const SkillReadSchema = z.object({ profile: ProfileName, path: z.string().max(400).refine(validSkillPath) })
const SkillsLedgerSchema = z.object({ profile: ProfileName, limit: z.number().int().min(1).max(500) })
const SkillsBlobsSchema = z.object({ profile: ProfileName, shas: z.array(z.string().regex(SHA_RE)).min(1).max(4) })
const SkillInspectSchema = z.object({ profile: ProfileName, id: HubId })
const TermSizeSchema = z.object({ cols: z.number().int().min(TERM_COLS.min).max(TERM_COLS.max), rows: z.number().int().min(TERM_ROWS.min).max(TERM_ROWS.max) })
const TermId = z.string().regex(TERM_ID_RE)
const CronOutputSchema = z.object({ profile: ProfileName, jobId: JobId, names: z.array(z.string().min(1).max(300)).min(1).max(2) })

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
    const parsed = (SETTINGS_SCHEMA[key] as { parse(v: unknown): unknown }).parse(value)
    d.store.setSetting(key, parsed as never)
    d.onSetting?.(key, parsed)
  })
  handle(IPC.updateGet, () => d.updates?.get() ?? null)
  handle(IPC.updateCheck, () => d.updates?.check() ?? null)
  handle(IPC.updateInstall, () => d.updates?.install() ?? false)
  handle(IPC.notifyTest, () => d.center?.test() ?? { shown: false, reason: 'Notifications are not available.' })
  handle(IPC.notifyChat, (a) => {
    // the renderer tells when a reply finished while that agent was not on screen; it never names a target of its own
    const { profile, title, body } = z.object({ profile: ProfileName, title: z.string().min(1).max(NOTICE_TITLE_MAX), body: z.string().max(NOTICE_BODY_MAX) }).parse(a)
    d.center?.push({ kind: 'chat', title, body, target: { kind: 'chat', profile } })
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
  handle(IPC.cronAction, (a) => d.session.cronAction(CronActionSchema.parse(a)))
  handle(IPC.cronRuns, (a) => d.session.cronRuns(CronRunsSchema.parse(a)))
  handle(IPC.cronRunOutput, (a) => d.session.cronRunOutput(CronOutputSchema.parse(a)))
  handle(IPC.opsMcpList, (a) => d.session.mcpList(ProfileName.parse(a)))
  handle(IPC.opsMcpTest, (a) => {
    const { profile, name } = z.object({ profile: ProfileName, name: z.string().regex(MCP_NAME_RE) }).parse(a)
    return d.session.mcpTest(profile, name)
  })
  handle(IPC.opsFallbackList, (a) => d.session.fallbackList(ProfileName.parse(a)))
  handle(IPC.opsToolsList, (a) => {
    const { profile, platforms } = z.object({ profile: ProfileName, platforms: z.array(z.string().regex(PLATFORM_RE)).min(1).max(24) }).parse(a)
    return d.session.toolsList(profile, platforms)
  })
  handle(IPC.opsToolsApply, (a) => {
    const { profile, changes } = z
      .object({ profile: ProfileName, changes: z.array(z.object({ toolset: z.string().regex(TOOLSET_RE), platform: z.string().regex(PLATFORM_RE), enable: z.boolean() })).min(1).max(200) })
      .parse(a)
    return d.session.toolsApply(profile, changes)
  })
  handle(IPC.opsProfileCreate, (a) =>
    d.session.profileCreate(
      z
        .object({
          name: z.string().regex(NEW_PROFILE_RE),
          description: z.string().max(DESCRIPTION_MAX).optional(),
          cloneFrom: ProfileName.optional(),
          noSkills: z.boolean(),
          alias: z.boolean()
        })
        .parse(a)
    )
  )
  handle(IPC.opsBackup, (a) => d.session.agentBackup(z.object({ profile: ProfileName, includeStateDb: z.boolean() }).parse(a), d.getWindow()))
  handle(IPC.termOpen, (a) => d.session.termOpen(TermSizeSchema.parse(a)))
  handle(IPC.termWrite, (a) => {
    const { id, data } = z.object({ id: TermId, data: z.string().min(1).max(TERM_WRITE_MAX) }).parse(a)
    return d.session.termWrite(id, data)
  })
  handle(IPC.termResize, (a) => {
    const { id, size } = z.object({ id: TermId, size: TermSizeSchema }).parse(a)
    d.session.termResize(id, size)
  })
  handle(IPC.termClose, (a) => d.session.termClose(TermId.parse(a)))
  handle(IPC.memoryVersions, (a) => {
    const { profile, file } = z.object({ profile: ProfileName, file: FileKind }).parse(a)
    return d.session.memoryVersions(profile, file)
  })
  handle(IPC.memoryVersion, (a) => d.session.memoryVersion(z.number().int().min(1).parse(a)))
  handle(IPC.memoryClear, () => d.session.memoryClear())
  handle(IPC.skillsList, (a) => d.session.skillsList(SkillsListSchema.parse(a)))
  handle(IPC.skillRead, (a) => d.session.skillRead(SkillReadSchema.parse(a)))
  handle(IPC.skillsLedger, (a) => d.session.skillsLedger(SkillsLedgerSchema.parse(a)))
  handle(IPC.skillsBlobs, (a) => d.session.skillsBlobs(SkillsBlobsSchema.parse(a)))
  handle(IPC.skillsAction, (a) => d.session.skillAction(SkillActionSchema.parse(a)))
  handle(IPC.skillsInspect, (a) => {
    const { profile, id } = SkillInspectSchema.parse(a)
    return d.session.skillInspect(profile, id)
  })
  handle(IPC.skillsCuratorStatus, (a) => d.session.curatorStatus(ProfileName.parse(a)))
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
