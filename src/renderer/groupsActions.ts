import type { GroupEvent, GroupRoom, GroupSendError } from '@shared/groups'
import { isViewing, roomKey } from './lib/unread'
import { playReplySound } from './soundActions'
import { useAgents } from './stores/agents'
import { useChat } from './stores/chat'
import { useGroups } from './stores/groups'
import { useUi } from './stores/ui'
import { useUnread } from './stores/unread'

let listSeq = 0
const entriesSeq: Record<string, number> = {}

export async function loadGroups(): Promise<void> {
  const seq = ++listSeq
  try {
    const list = await window.mc.groups.list()
    if (seq === listSeq) useGroups.getState().setList(list)
  } catch {
    // not connected yet: the list loads again on connect
  }
}

export async function loadEntries(id: string): Promise<void> {
  const seq = (entriesSeq[id] = (entriesSeq[id] ?? 0) + 1)
  const st = useGroups.getState()
  if (!st.entries[id]) st.setEntriesState(id, 'loading')
  try {
    const entries = await window.mc.groups.entries({ id })
    if (seq === entriesSeq[id]) useGroups.getState().setEntries(id, entries)
  } catch {
    if (seq === entriesSeq[id]) useGroups.getState().setEntriesState(id, 'error')
  }
}

/** Opens a room in the Chat screen. */
export function openGroup(id: string): void {
  useGroups.getState().setCurrent(id)
  useUnread.getState().clear(roomKey(id))
  if (!useGroups.getState().entries[id]) void loadEntries(id)
}

/** Goes back to an agent's chat in the Chat screen. */
export function openDm(profile: string): void {
  useGroups.getState().setCurrent(null)
  useChat.getState().setCurrent(profile)
}

export async function createGroup(name: string, members: string[]): Promise<string | null> {
  const r = await window.mc.groups.create({ name, members })
  if ('error' in r) return r.error
  await loadGroups()
  useGroups.getState().setEntries(r.id, [])
  openGroup(r.id)
  return null
}

export async function updateGroup(id: string, patch: { name?: string; members?: string[] }): Promise<string | null> {
  const r = await window.mc.groups.update({ id, ...patch })
  if ('error' in r) return r.error
  await loadGroups()
  return null
}

export async function deleteGroup(id: string): Promise<void> {
  await window.mc.groups.remove(id)
  const st = useGroups.getState()
  if (st.current === id) st.setCurrent(null)
  st.setEntries(id, null)
  useUnread.getState().clear(roomKey(id))
  await loadGroups()
}

export function sendErrorText(error: GroupSendError, detail?: string): string {
  switch (error) {
    case 'not-connected':
      return 'Not connected to the server.'
    case 'busy':
      return 'The room is still answering. Wait for it, or press Stop.'
    case 'empty':
      return 'Write a message first.'
    case 'too-long':
      return 'The message is too long.'
    case 'not-found':
      return 'This room does not exist any more.'
    case 'no-gateway':
      return detail ?? 'Rooms need the Hermes TUI gateway.'
  }
}

export async function sendToGroup(id: string): Promise<void> {
  const st = useGroups.getState()
  const text = (st.drafts[id] ?? '').trim()
  if (!text || st.running[id] || st.sending[id]) return
  st.setSending(id, true, null)
  try {
    const r = await window.mc.groups.send({ id, text })
    if (r.ok) {
      useGroups.getState().setDraft(id, '')
      useGroups.getState().setSending(id, false, null)
    } else {
      useGroups.getState().setSending(id, false, sendErrorText(r.error, r.detail))
      if (r.error === 'no-gateway') void loadGroups()
    }
  } catch (e) {
    useGroups.getState().setSending(id, false, e instanceof Error ? e.message : String(e))
  }
}

export async function stopGroup(id: string): Promise<void> {
  await window.mc.groups.stop(id)
}

export async function answerGroupApproval(turn: string, approval: string, option: string | null): Promise<void> {
  await window.mc.groups.approve({ turn, approval, option })
}

export async function clearGroupHistory(): Promise<void> {
  await window.mc.groups.clear()
  const st = useGroups.getState()
  for (const r of st.rooms) st.setEntries(r.id, null)
  if (st.current) void loadEntries(st.current)
  await loadGroups()
}

function viewingRoom(id: string): boolean {
  const visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  const focused = typeof document === 'undefined' ? true : document.hasFocus()
  return isViewing({ route: useUi.getState().route, chatCurrent: useChat.getState().current, agentSelected: useAgents.getState().selected, roomCurrent: useGroups.getState().current, visible, focused }, roomKey(id))
}

/** One event from the main process: the store, and at the end of a run the badge, the notice and the sound. */
export function onGroupEvent(ev: GroupEvent): void {
  useGroups.getState().apply(ev)
  if (ev.kind === 'changed') void loadGroups()
  if (ev.kind !== 'run-end') return
  void loadGroups()
  const away = !viewingRoom(ev.groupId)
  if (away && (ev.replies > 0 || ev.needsYou)) {
    for (let i = 0; i < Math.max(1, ev.replies); i++) useUnread.getState().add(roomKey(ev.groupId))
    void window.mc.notify.group(ev.groupId, ev.replies, ev.needsYou)
  }
  if (ev.replies > 0) playReplySound(away)
}

export const roomOf = (id: string | null): GroupRoom | null => (id ? (useGroups.getState().rooms.find((r) => r.id === id) ?? null) : null)
