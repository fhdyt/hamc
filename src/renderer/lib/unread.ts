import type { Route } from '../stores/ui'

export interface ViewState {
  route: Route
  /** The agent open in the Chat screen. */
  chatCurrent: string | null
  /** The agent selected on the Dashboard (its chat room is in the agents panel). */
  agentSelected: string | null
  visible: boolean
  focused: boolean
}

/** Whether this agent's chat room is on screen right now, in a window the user can see. */
export function isViewing(s: ViewState, profile: string): boolean {
  if (!s.visible || !s.focused) return false
  return (s.route === 'chat' && s.chatCurrent === profile) || (s.route === 'dashboard' && s.agentSelected === profile)
}

/** A reply is worth a badge only when the turn ended cleanly and the user did not stop it. */
export function shouldCount(ev: { kind: string; exitCode?: number | null; stopped?: boolean }): boolean {
  return ev.kind === 'end' && ev.exitCode === 0 && ev.stopped === false
}
