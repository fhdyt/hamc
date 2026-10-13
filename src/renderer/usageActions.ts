import { sinceFor, type Range } from '@shared/sessions'
import { dayStartsFor, usageDays } from '@shared/usage'
import { saveSetting } from './actions'
import { describeQueryError } from './lib/queryError'
import { openSession } from './sessionsActions'
import { useAgents } from './stores/agents'
import { useSessions } from './stores/sessions'
import { useUi } from './stores/ui'
import { useUsage } from './stores/usage'

let summarySeq = 0
let toolsSeq = 0

/** The selection the screen shows: the shared agent and range, as profiles and the local days of this computer. */
function selection(): { profiles: string[]; dayStarts: number[]; endTs: number } {
  const s = useUi.getState().settings
  const known = useAgents.getState().agents.map((a) => a.profile)
  const agent = s['filters.agent']
  const { dayStarts, endTs } = dayStartsFor(usageDays(s['filters.range']), Date.now() / 1000)
  return { profiles: agent !== 'all' && known.includes(agent) ? [agent] : [], dayStarts, endTs }
}

async function fetchSummary(quiet: boolean): Promise<void> {
  const sel = selection()
  const my = ++summarySeq
  if (!quiet) useUsage.getState().setStatus('loading')
  const res = await window.mc.usage.summary({ profiles: sel.profiles, dayStarts: sel.dayStarts, endTs: sel.endTs })
  if (my !== summarySeq) return
  if (res.ok) useUsage.getState().applySummary(res.data, sel.dayStarts)
  else useUsage.getState().setError(describeQueryError(res.error, res.detail))
}

async function fetchTools(quiet: boolean): Promise<void> {
  const sel = selection()
  const my = ++toolsSeq
  if (!quiet) useUsage.getState().setToolsStatus('loading')
  const res = await window.mc.usage.tools({ profiles: sel.profiles, sinceTs: sel.dayStarts[0]!, endTs: sel.endTs })
  if (my !== toolsSeq) return
  if (res.ok) useUsage.getState().applyTools(res.data)
  else useUsage.getState().setToolsError(describeQueryError(res.error, res.detail))
}

export const loadUsage = (): Promise<void> => fetchSummary(false)
export const loadTools = (): Promise<void> => fetchTools(false)

/** The timer's quiet re-read of the tab on screen; the numbers stay if it fails. */
export function refreshUsage(): Promise<void> {
  const st = useUsage.getState()
  if (st.tab === 'tools') return st.toolsStatus === 'loading' ? Promise.resolve() : fetchTools(true)
  return st.status === 'loading' ? Promise.resolve() : fetchSummary(true)
}

/** The agent and range are shared with the other screens, so they are saved. Both tabs read the new selection. */
export async function setUsageFilter(patch: { agent?: string; range?: Range }): Promise<void> {
  if (patch.agent !== undefined) await saveSetting('filters.agent', patch.agent)
  if (patch.range !== undefined) await saveSetting('filters.range', patch.range)
  useUsage.getState().clearData()
  await Promise.all([loadUsage(), useUsage.getState().tab === 'tools' ? loadTools() : Promise.resolve()])
}

/** Asks the main process to check today's cost now (after the alert setting changed). */
export function recheckAlert(): Promise<void> {
  return window.mc.alerts.recheck()
}

const REVIEW_RANGES: Range[] = ['today', '7d', '14d', '30d']

/** Opens Sessions on the smallest shared range that still contains this day. */
export function reviewDayInSessions(dayIndex: number): void {
  const dayStart = useUsage.getState().dayStarts[dayIndex]
  if (dayStart === undefined) return
  const now = Date.now() / 1000
  const range = REVIEW_RANGES.find((r) => (sinceFor(r, now) ?? 0) <= dayStart) ?? '30d'
  void saveSetting('filters.range', range)
  useSessions.getState().reset()
  useUi.getState().navigate('sessions')
}

/** Opens the session of a failed tool call in Sessions. */
export function openToolFailure(profile: string, sessionId: string): void {
  useUi.getState().navigate('sessions')
  void openSession(profile, sessionId)
}
