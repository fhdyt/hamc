import { create } from 'zustand'
import type {
  Capabilities, ConnStatus, ConnectErrorKind, ConnectRequest, HostKeyChallenge, PreflightResult, SavedConnection, StartupProgress
} from '@shared/ipc'

interface ConnState {
  status: ConnStatus
  saved: SavedConnection | null
  savedLoaded: boolean
  secret: { canRemember: boolean; reason: string | null } | null
  startup: StartupProgress | null
  preflight: PreflightResult | null
  capabilities: Capabilities | null
  hostKey: HostKeyChallenge | null
  connectError: { kind: ConnectErrorKind; message: string } | null
  connecting: boolean
  /** Last connect request without the password, so a host key can be trusted and the attempt repeated. */
  lastRequest: Omit<ConnectRequest, 'password'> | null
  /** F-CONN-14: every saved server, the newest connected first. */
  servers: SavedConnection[]
  /** Bumped to make the Launch screen connect again (a switch to another server). */
  launchSeq: number
  /** A switch that waits for "This stops: ..." to be answered. */
  switchAsk: { id: number; name: string; lines: string[] } | null
}

export const IDLE_STATUS: ConnStatus = { state: 'idle', latencyMs: null, hermesVersion: null, attempt: 0, nextRetryInS: null, error: null }

export const useConn = create<ConnState>()(() => ({
  status: IDLE_STATUS,
  saved: null,
  savedLoaded: false,
  secret: null,
  startup: null,
  preflight: null,
  capabilities: null,
  hostKey: null,
  connectError: null,
  connecting: false,
  lastRequest: null,
  servers: [],
  launchSeq: 0,
  switchAsk: null
}))
