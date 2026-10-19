import type { Route } from '../stores/ui'

export interface ViewState {
  route: Route
  /** The agent open in the Chat screen. */
  chatCurrent: string | null
  /** The agent selected on the Dashboard (its chat room is in the agents panel). */
  agentSelected: string | null
  /** The group chat room open in the Chat screen (it replaces the agent's chat there). */
  roomCurrent?: string | null
  visible: boolean
  focused: boolean
}

/** The unread key of a group chat room (unread counts keep agents and rooms together, so the Chat badge sums both). */
export const roomKey = (id: string): string => `room:${id}`

/** Whether this agent's chat (or, for a `room:` key, this room) is on screen right now, in a window the user can see. */
export function isViewing(s: ViewState, key: string): boolean {
  if (!s.visible || !s.focused) return false
  const room = s.roomCurrent ?? null
  if (key.startsWith('room:')) return s.route === 'chat' && room === key.slice(5)
  return (s.route === 'chat' && room === null && s.chatCurrent === key) || (s.route === 'dashboard' && s.agentSelected === key)
}

/** A reply is worth a badge only when the turn ended cleanly and the user did not stop it. */
export function shouldCount(ev: { kind: string; exitCode?: number | null; stopped?: boolean }): boolean {
  return ev.kind === 'end' && ev.exitCode === 0 && ev.stopped === false
}
