import { resetServerStores } from './actions'
import { busyWork, serverName } from './lib/servers'
import { unsavedFor, useAgentCfg } from './stores/agentCfg'
import { useChat } from './stores/chat'
import { useConn } from './stores/conn'
import { useGroups } from './stores/groups'
import { useUi } from './stores/ui'

/** F-CONN-14: the saved servers, newest connected first. */
export async function loadServers(): Promise<void> {
  useConn.setState({ servers: await window.mc.connection.list() })
}

/** What a switch would stop right now: replies being written, room runs, uploads and unsaved agent settings. */
export function currentBusyWork(): string[] {
  const rooms = Object.values(useChat.getState().rooms)
  return busyWork({
    chats: rooms.filter((r) => r.sending || (r.turn !== null && !r.turn.ended)).length,
    rooms: Object.values(useGroups.getState().running).filter(Boolean).length,
    uploads: rooms.reduce((n, r) => n + r.files.filter((f) => f.state === 'uploading').length, 0),
    drafts: unsavedFor(useAgentCfg.getState()) ? 1 : 0
  })
}

/**
 * Connects another saved server: what it would stop is asked first (unless `force`), every store of the old server is
 * emptied (the terminal's server tabs close with them) and the Launch screen connects. The server on screen, while
 * connected, only opens Settings → Servers.
 */
export function switchServer(id: number, force = false): void {
  const { servers, saved, status } = useConn.getState()
  const target = servers.find((s) => s.id === id)
  const ui = useUi.getState()
  if (!target) return
  if (saved?.id === id && status.state !== 'idle') return ui.openSettings('connection')
  if (!force) {
    const lines = currentBusyWork()
    if (lines.length > 0) return useConn.setState({ switchAsk: { id, name: serverName(target), lines } })
  }
  useConn.setState({ switchAsk: null })
  resetServerStores()
  useConn.setState((s) => ({ saved: target, startup: null, preflight: null, hostKey: null, connectError: null, launchSeq: s.launchSeq + 1 }))
  ui.closeSettings()
  ui.navigate('launch')
}
