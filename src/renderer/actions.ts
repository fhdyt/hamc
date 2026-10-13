import type { FeedItem } from '@shared/events'
import type { ConnectRequest, ConnectResult } from '@shared/ipc'
import type { BrainGraphSettings, SettingsMap } from '@shared/settings'
import { fullRequest, oldestPerProfile } from './lib/feed'
import { defaultPins, reorderPins, togglePin } from './lib/roster'
import { stepZoom } from './lib/zoom'
import { useAgents } from './stores/agents'
import { IDLE_STATUS, useConn } from './stores/conn'
import { useBrain } from './stores/brain'
import { useChat } from './stores/chat'
import { useCron } from './stores/cron'
import { useFeed } from './stores/feed'
import { useInteractions } from './stores/interactions'
import { useKanban } from './stores/kanban'
import { useMetrics } from './stores/metrics'
import { useCostAlert } from './stores/costAlert'
import { useLogs } from './stores/logs'
import { usePalette } from './stores/palette'
import { useSessions } from './stores/sessions'
import { useUnread } from './stores/unread'
import { useUsage } from './stores/usage'
import { useSkills } from './stores/skills'
import { useUi } from './stores/ui'

export async function runConnect(req: ConnectRequest): Promise<ConnectResult> {
  const { password: _password, ...withoutPassword } = req
  useConn.setState({ connecting: true, connectError: null, hostKey: null, lastRequest: withoutPassword })
  // Feed ids only mean something on one server; drop what a different server left behind before new events arrive.
  const prev = useConn.getState().saved
  if (prev && (prev.host !== req.host || prev.port !== req.port || prev.username !== req.username)) {
    useFeed.getState().reset()
    useInteractions.getState().reset()
    useChat.getState().reset()
    useSessions.getState().reset()
    useUsage.getState().reset()
    usePalette.getState().reset()
    useLogs.getState().reset()
    useKanban.getState().reset()
    useSkills.getState().reset()
    useUnread.getState().reset()
    useCostAlert.getState().reset()
  }
  const res = await window.mc.connection.connect(req)
  if (res.ok) {
    useConn.setState({ connecting: false, saved: await window.mc.connection.saved(), connectError: null, hostKey: null })
    return res
  }
  useConn.setState({
    connecting: false,
    connectError: { kind: res.kind, message: res.message },
    hostKey: res.hostKey ?? null,
    ...(res.preflight ? { preflight: res.preflight } : {})
  })
  return res
}

/** Trust the pending host key and repeat the last attempt. The main process still holds the password for ~2 minutes. */
export async function trustAndRetry(): Promise<ConnectResult | null> {
  const { hostKey, lastRequest } = useConn.getState()
  if (!hostKey || !lastRequest) return null
  await window.mc.connection.trustHostKey(hostKey)
  useConn.setState({ hostKey: null })
  return runConnect(lastRequest)
}

export async function forgetConnection(): Promise<void> {
  await window.mc.connection.forget()
  useAgents.getState().reset()
  useMetrics.getState().reset()
  useCron.getState().reset()
  useFeed.getState().reset()
  useInteractions.getState().reset()
  useSessions.getState().reset()
  useUsage.getState().reset()
  usePalette.getState().reset()
  useLogs.getState().reset()
  useKanban.getState().reset()
  useUnread.getState().reset()
  useCostAlert.getState().reset()
  useBrain.getState().reset()
  useChat.getState().reset()
  useConn.setState({
    saved: null, status: IDLE_STATUS, startup: null, preflight: null, capabilities: null, hostKey: null, connectError: null, lastRequest: null
  })
  useUi.getState().closeSettings()
  useUi.getState().navigate('connect')
}

export async function saveSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void> {
  useUi.getState().patchSettings({ [key]: value } as Partial<SettingsMap>)
  await window.mc.settings.set(key, value)
}

/** Reset settings (F-APP-5): every app setting goes back to its default; the connection and the window size stay. */
export async function resetSettings(): Promise<void> {
  const settings = await window.mc.settings.reset()
  useUi.getState().hydrate(settings)
  await window.mc.app.setZoom(settings['ui.zoom'])
}

export async function setZoomLevel(z: number): Promise<void> {
  await window.mc.app.setZoom(z)
  await saveSetting('ui.zoom', z)
}

export async function stepZoomLevel(dir: 1 | -1): Promise<void> {
  await setZoomLevel(stepZoom(useUi.getState().settings['ui.zoom'], dir))
}

let pinsLoading = false
export async function ensurePins(): Promise<void> {
  const a = useAgents.getState()
  if (a.pinsReady || pinsLoading || a.agents.length === 0) return
  pinsLoading = true
  try {
    const { pins, initialized } = await window.mc.agents.getPins()
    if (initialized) {
      useAgents.getState().setPins(pins)
    } else {
      const initial = defaultPins(useAgents.getState().agents)
      await window.mc.agents.setPins(initial)
      useAgents.getState().setPins(initial)
    }
  } finally {
    pinsLoading = false
  }
}

export async function toggleAgentPin(profile: string): Promise<void> {
  const next = togglePin(useAgents.getState().pins, profile)
  useAgents.getState().setPins(next)
  await window.mc.agents.setPins(next)
}

export async function reorderAgentPin(from: string, to: string): Promise<void> {
  const next = reorderPins(useAgents.getState().pins, from, to)
  useAgents.getState().setPins(next)
  await window.mc.agents.setPins(next)
}

/**
 * Loads older items for the profiles that may still have some. Does nothing while a load is running
 * or when every profile is exhausted.
 */
export async function loadOlderFeed(profiles: readonly string[]): Promise<void> {
  const s = useFeed.getState()
  if (s.loadingOlder) return
  const oldest = oldestPerProfile(s.items)
  const before: Record<string, number> = {}
  for (const p of profiles) if (!s.exhausted[p] && oldest[p] !== undefined) before[p] = oldest[p]!
  if (Object.keys(before).length === 0) return
  s.setLoadingOlder(true)
  const res = await window.mc.feed.history(before, 50)
  if (!res.ok) {
    useFeed.getState().setLoadingOlder(false, res.error)
    return
  }
  useFeed.getState().mergeOlder(res.data.items, res.data.exhausted)
}

const FULL_ERRORS: Record<string, string> = {
  not_found: 'This message is no longer in the database.',
  timeout: 'The server took too long to answer.',
  'not-connected': 'Not connected to the server.'
}

/** Fetches the complete text of a truncated item once; later calls reuse the result. */
export async function loadFullText(it: FeedItem): Promise<void> {
  const cur = useFeed.getState().full[it.id]
  if (cur && cur.status !== 'error') return
  useFeed.getState().setFull(it.id, { status: 'loading' })
  const { field, index } = fullRequest(it)
  const res = await window.mc.feed.message(it.profile, it.messageId, field, index)
  useFeed.getState().setFull(it.id, res.ok ? { status: 'ok', text: res.data.text } : { status: 'error', message: FULL_ERRORS[res.error] ?? 'Could not load the full text.' })
}

/** Opens the Live feed filtered to one agent. */
export function openFeedFor(profile: string): void {
  useFeed.getState().soloAgent(profile, useAgents.getState().agents.map((a) => a.profile))
  useUi.getState().navigate('feed')
}

/** Reads the saved vault path of this connection from the main process. */
export async function refreshVault(): Promise<void> {
  const { vault } = await window.mc.brain.get()
  useBrain.getState().setVault(vault)
}

/** Saves a new vault path (or clears it); the main process restarts the vault stream. */
export async function saveVault(path: string | null): Promise<void> {
  await window.mc.brain.setVault(path)
  useBrain.getState().setVault(path)
}

let graphSaveTimer: number | undefined
/** Applies graph settings at once and writes them to app.db shortly after the last change (sliders fire many). */
export function saveGraphSettings(patch: Partial<BrainGraphSettings>): void {
  const next = { ...useUi.getState().settings['brain.graph'], ...patch }
  useUi.getState().patchSettings({ 'brain.graph': next })
  window.clearTimeout(graphSaveTimer)
  graphSaveTimer = window.setTimeout(() => void window.mc.settings.set('brain.graph', useUi.getState().settings['brain.graph']), 400)
}
