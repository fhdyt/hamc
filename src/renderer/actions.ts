import type { ConnectRequest, ConnectResult } from '@shared/ipc'
import type { SettingsMap } from '@shared/settings'
import { defaultPins, reorderPins, togglePin } from './lib/roster'
import { stepZoom } from './lib/zoom'
import { useAgents } from './stores/agents'
import { IDLE_STATUS, useConn } from './stores/conn'
import { useCron } from './stores/cron'
import { useMetrics } from './stores/metrics'
import { useUi } from './stores/ui'

export async function runConnect(req: ConnectRequest): Promise<ConnectResult> {
  const { password: _password, ...withoutPassword } = req
  useConn.setState({ connecting: true, connectError: null, hostKey: null, lastRequest: withoutPassword })
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
