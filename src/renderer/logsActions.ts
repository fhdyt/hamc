import type { GatewayAction, GatewayActionResult, LogFileName } from '@shared/logs'
import { saveSetting } from './actions'
import { describeQueryError } from './lib/queryError'
import { useAgents } from './stores/agents'
import { useLogs } from './stores/logs'
import { useUi } from './stores/ui'

const FIRST_READ = 500
const OLDER_READ = 2000
let seq = 0

/** The agent whose logs are shown: the shared agent filter, else the default agent, else the first one. */
function currentProfile(): string {
  const agents = useAgents.getState().agents
  const shared = useUi.getState().settings['filters.agent']
  if (shared !== 'all' && agents.some((a) => a.profile === shared)) return shared
  return agents.find((a) => a.profile === 'default')?.profile ?? agents[0]?.profile ?? 'default'
}

async function readInitial(my: number, profile: string, file: LogFileName, limit: number): Promise<void> {
  const res = await window.mc.logs.read({ profile, file, limit })
  if (my !== seq) return
  if (res.ok) useLogs.getState().applyInitial(res.data, limit)
  else useLogs.getState().setError(describeQueryError(res.error, res.detail))
}

/** Opens the logs of the current agent: lists its files, picks one and reads the last lines. */
export async function openLogs(): Promise<void> {
  const my = ++seq
  const profile = currentProfile()
  const st = useLogs.getState()
  st.setProfile(profile)
  const list = await window.mc.logs.list({ profiles: [profile] })
  if (my !== seq) return
  if (!list.ok) {
    useLogs.getState().setError(describeQueryError(list.error, list.detail))
    return
  }
  const files = list.data.files.filter((f) => f.profile === profile)
  const s = useLogs.getState()
  s.applyFiles(files)
  const names = files.map((f) => f.name)
  const file = (s.pendingFile && names.includes(s.pendingFile) ? s.pendingFile : s.file && names.includes(s.file) ? s.file : names.includes('agent.log') ? 'agent.log' : names[0]) as LogFileName | undefined
  useLogs.setState({ pendingFile: null })
  if (!file) {
    useLogs.setState({ file: null, lines: [], offset: 0, more: false, status: 'ok', error: null })
    return
  }
  if (file !== useLogs.getState().file) useLogs.getState().selectFile(file)
  await readInitial(my, profile, file, FIRST_READ)
}

export async function setLogFile(file: LogFileName): Promise<void> {
  const my = ++seq
  const { profile } = useLogs.getState()
  if (!profile) return
  useLogs.getState().selectFile(file)
  useLogs.getState().setStatus('loading')
  await readInitial(my, profile, file, FIRST_READ)
}

/** Another agent: the shared agent filter changes for every screen, then its logs open. */
export async function setLogAgent(profile: string): Promise<void> {
  await saveSetting('filters.agent', profile)
  await openLogs()
}

/** Reads further back, as far as one read allows. */
export async function loadLogsOlder(): Promise<void> {
  const my = ++seq
  const { profile, file } = useLogs.getState()
  if (!profile || !file) return
  await readInitial(my, profile, file, OLDER_READ)
}

/** One Follow step: the lines written since the last read. The timer lives in the screen. */
export async function followTick(): Promise<void> {
  const st = useLogs.getState()
  if (!st.following || !st.profile || !st.file || st.status === 'idle' || st.status === 'loading') return
  const my = seq
  const { profile, file, offset } = st
  const res = await window.mc.logs.read({ profile, file, after: offset, limit: FIRST_READ })
  if (my !== seq || useLogs.getState().file !== file) return
  if (res.ok) useLogs.getState().applyFollow(res.data)
  else useLogs.getState().setError(describeQueryError(res.error, res.detail))
}

export function runGatewayAction(action: GatewayAction, profile: string): Promise<GatewayActionResult> {
  return window.mc.gateway.action({ action, profile })
}

export async function loadApprovals(profile: string): Promise<void> {
  useLogs.getState().setApprovals(profile, { status: 'loading' })
  const res = await window.mc.approvals.read(profile)
  useLogs.getState().setApprovals(
    profile,
    res.ok
      ? { status: 'ok', policy: res.policy, policyError: res.policyError, suggest: res.suggest, suggestError: res.suggestError }
      : { status: 'error', message: res.error === 'not-connected' ? 'Not connected to the server.' : 'Hermes cannot take that agent name.' }
  )
}

/** The palette action "Show errors from the last hour": errors.log, only ERROR and CRITICAL, the last hour. */
export function openLogsOnErrors(): void {
  void saveSetting('logs.levels', ['ERROR', 'CRITICAL'])
  void saveSetting('logs.range', '1h')
  useLogs.setState({ tab: 'logs', pendingFile: 'errors.log', component: 'all', query: '' })
  useUi.getState().navigate('logs')
}
