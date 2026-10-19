import { describeQueryError } from './lib/queryError'
import type { PaletteItem } from './lib/palette'
import { isViewing } from './lib/unread'
import { openLogsOnErrors } from './logsActions'
import { openSession } from './sessionsActions'
import { useAgentCfg } from './stores/agentCfg'
import { useAgents } from './stores/agents'
import { useBrain } from './stores/brain'
import { useChat } from './stores/chat'
import { useCron } from './stores/cron'
import { useGroups } from './stores/groups'
import { openDm, openGroup } from './groupsActions'
import { usePalette } from './stores/palette'
import { useUi } from './stores/ui'
import { useUnread } from './stores/unread'
import { useUsage } from './stores/usage'
import { toggleTerminal } from './terminalToggle'

const FRESH_MS = 60_000
const SESSION_LIMIT = 100
let loadSeq = 0

/** The newest sessions, for "jump to a session". One read-only query; typing in the palette only filters what is loaded. */
export async function loadPaletteSessions(force = false): Promise<void> {
  const st = usePalette.getState()
  if (!force && (st.loading || (st.loadedAt !== null && Date.now() - st.loadedAt < FRESH_MS))) return
  const my = ++loadSeq
  st.setLoading(true)
  const res = await window.mc.sessions.list({ profiles: [], limit: SESSION_LIMIT })
  if (my !== loadSeq) return
  if (res.ok) usePalette.getState().applySessions(res.data.rows)
  else usePalette.getState().setError(describeQueryError(res.error, res.detail))
}

export function openPalette(): void {
  usePalette.getState().setOpen(true)
  void loadPaletteSessions()
}

export function closePalette(): void {
  usePalette.getState().setOpen(false)
}

export function togglePalette(): void {
  if (usePalette.getState().open) closePalette()
  else openPalette()
}

/** Closes the palette, then does what the item says. */
export function runItem(item: PaletteItem): void {
  closePalette()
  const ui = useUi.getState()
  const t = item.target
  switch (t.kind) {
    case 'screen':
      ui.navigate(t.route)
      return
    case 'chat':
      useAgents.getState().select(t.profile)
      openDm(t.profile)
      ui.navigate('chat')
      return
    case 'room':
      openGroup(t.id)
      ui.navigate('chat')
      return
    case 'agent-settings':
      useAgentCfg.getState().selectProfile(t.profile)
      useAgentCfg.getState().setTab(t.tab)
      ui.openSettings('agents')
      return
    case 'session':
      ui.navigate('sessions')
      void openSession(t.profile, t.id)
      return
    case 'note':
      useBrain.getState().openNote(t.id)
      return
    case 'action':
      if (t.action === 'settings') ui.openSettings('general')
      else if (t.action === 'connection') ui.openSettings('connection')
      else if (t.action === 'errors-hour') openLogsOnErrors()
      else if (t.action === 'terminal') toggleTerminal()
      else if (t.action === 'cron') {
        ui.navigate('dashboard')
        useCron.getState().openModal()
      } else {
        useUsage.getState().setTab('cost')
        useUsage.getState().requestPinToday()
        ui.navigate('usage')
      }
  }
}

/** A chat turn ended cleanly: it is unread when that agent's room is not on screen in a window the user can see. */
export function countIfAway(profile: string): boolean {
  const ui = useUi.getState()
  const visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  const focused = typeof document === 'undefined' ? true : document.hasFocus()
  const viewing = isViewing({ route: ui.route, chatCurrent: useChat.getState().current, agentSelected: useAgents.getState().selected, roomCurrent: useGroups.getState().current, visible, focused }, profile)
  if (!viewing) useUnread.getState().add(profile)
  return !viewing
}
