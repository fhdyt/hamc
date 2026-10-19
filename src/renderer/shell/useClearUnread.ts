import { useEffect } from 'react'
import { isViewing } from '../lib/unread'
import { useAgents } from '../stores/agents'
import { useChat } from '../stores/chat'
import { useGroups } from '../stores/groups'
import { useUi } from '../stores/ui'
import { useUnread } from '../stores/unread'

/** Clears the unread count of whichever agent chat or group room is on screen in a visible, focused window. */
export function useClearUnread(): void {
  const route = useUi((s) => s.route)
  const current = useChat((s) => s.current)
  const selected = useAgents((s) => s.selected)
  const room = useGroups((s) => s.current)

  useEffect(() => {
    const clearViewed = (): void => {
      const counts = useUnread.getState().counts
      const ui = useUi.getState()
      const view = {
        route: ui.route,
        chatCurrent: useChat.getState().current,
        agentSelected: useAgents.getState().selected,
        roomCurrent: useGroups.getState().current,
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus()
      }
      for (const profile of Object.keys(counts)) if (isViewing(view, profile)) useUnread.getState().clear(profile)
    }
    clearViewed()
    window.addEventListener('focus', clearViewed)
    document.addEventListener('visibilitychange', clearViewed)
    return () => {
      window.removeEventListener('focus', clearViewed)
      document.removeEventListener('visibilitychange', clearViewed)
    }
  }, [route, current, selected, room])
}
