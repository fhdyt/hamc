import type { ChatSendError } from '@shared/ipc'
import { emptyRoom, useChat, type AttFile } from './stores/chat'

const SEND_ERRORS: Record<ChatSendError, string> = {
  'not-connected': 'Not connected to the server.',
  busy: 'This agent is still answering. Wait for it, or press Stop.',
  empty: 'Write a message first.',
  'too-long': 'The message is too long.',
  'bad-profile': 'This agent name cannot be used for chat.',
  'hermes-missing': 'The Hermes command was not found on the server.',
  'upload-failed': 'The files could not be uploaded.',
  'attachment-missing': 'A file was removed before it could be sent. Attach it again.',
  'failed-to-start': 'Hermes could not be started on the server.'
}

const room = (profile: string) => useChat.getState().rooms[profile] ?? emptyRoom()
const patch = (profile: string, fn: Parameters<ReturnType<typeof useChat.getState>['patch']>[1]): void => useChat.getState().patch(profile, fn)

/** Reads the saved session of an agent and loads its history, once. */
export async function openRoom(profile: string): Promise<void> {
  const r = room(profile)
  let sessionId = r.sessionId
  if (!r.loaded) {
    sessionId = await window.mc.chat.getSession(profile)
    patch(profile, () => ({ sessionId, loaded: true }))
  }
  if (sessionId && room(profile).historyState === 'idle') await loadHistory(profile)
}

export async function loadHistory(profile: string): Promise<void> {
  const sid = room(profile).sessionId
  if (!sid) return
  patch(profile, () => ({ historyState: 'loading', historyError: null }))
  const res = await window.mc.feed.session(profile, sid)
  // the session may have changed while this was loading
  if (room(profile).sessionId !== sid) return
  if (res.ok) patch(profile, () => ({ history: res.data.items, historyState: 'ok' }))
  else patch(profile, () => ({ historyState: 'error', historyError: res.error === 'not_found' ? 'This conversation is no longer in the server database.' : 'The conversation could not be loaded.' }))
}

export async function sendMessage(profile: string, text: string): Promise<void> {
  const r = room(profile)
  const files = r.files.filter((f) => !f.problem)
  patch(profile, () => ({
    sending: true,
    sendError: null,
    pending: { text, at: Date.now(), attachments: files.map((f) => ({ name: f.name, ...(f.thumb ? { thumb: f.thumb } : {}) })) },
    draft: ''
  }))
  const res = await window.mc.chat.send({ profile, text, attachmentIds: files.map((f) => f.id) })
  if (!res.ok) {
    patch(profile, (cur) => ({
      sending: false,
      pending: null,
      draft: cur.draft || text,
      sendError: `${SEND_ERRORS[res.error]}${res.detail && res.error === 'upload-failed' ? ` ${res.detail}` : ''}`,
      files: cur.files.map((f) => (f.state === 'uploading' ? { ...f, state: 'ready' as const, sent: 0 } : f))
    }))
    return
  }
  patch(profile, () => ({ files: [] }))
}

export async function stopTurn(profile: string): Promise<void> {
  const t = room(profile).turn
  if (t && !t.ended) await window.mc.chat.stop(t.id)
}

/** Answers a question from Hermes (ACP mode). `option` null cancels it. */
export async function answerApproval(turn: string, approval: string, option: string | null): Promise<void> {
  await window.mc.chat.approve({ turn, approval, option })
}

/** Starts a fresh conversation with the agent; the old one stays on the server and in the history menu. */
export async function newChat(profile: string): Promise<void> {
  await window.mc.chat.setSession(profile, null)
  patch(profile, () => ({ sessionId: null, loaded: true, history: [], historyState: 'idle', historyError: null, pending: null, turn: null, sendError: null }))
}

export async function resumeSession(profile: string, sessionId: string): Promise<void> {
  await window.mc.chat.setSession(profile, sessionId)
  patch(profile, () => ({ sessionId, loaded: true, history: [], historyState: 'idle', historyError: null, pending: null, turn: null, sendError: null }))
  await loadHistory(profile)
}

// ---- attachments ---------------------------------------------------------

const withState = (a: { id: string; name: string; size: number; mime: string; thumb?: string; problem?: string }): AttFile => ({ ...a, state: 'ready', sent: 0 })

/** Container backends cannot always see the upload folder (F-CHAT-14). */
async function warnAboutBackend(profile: string): Promise<void> {
  if (room(profile).backendWarning) return
  const b = await window.mc.chat.backend(profile)
  if (b && b.toLowerCase() !== 'local') {
    patch(profile, () => ({
      backendWarning: `This agent runs its commands in "${b}". Files in the upload folder may not be visible inside its sandbox; make sure that folder is mounted there.`
    }))
  }
}

function addFiles(profile: string, atts: Parameters<typeof withState>[0][]): void {
  if (atts.length === 0) return
  patch(profile, (r) => ({ files: [...r.files, ...atts.map(withState)].slice(0, 20), sendError: null }))
  void warnAboutBackend(profile)
}

export async function pickFiles(profile: string): Promise<void> {
  addFiles(profile, await window.mc.chat.pick())
}

export async function dropFiles(profile: string, files: File[]): Promise<void> {
  addFiles(profile, await window.mc.chat.attach(files))
}

export async function removeFile(profile: string, id: string): Promise<void> {
  const f = room(profile).files.find((x) => x.id === id)
  if (!f) return
  if (f.state === 'uploading') await window.mc.uploads.cancel(id)
  else await window.mc.chat.detach(id)
  patch(profile, (r) => ({ files: r.files.filter((x) => x.id !== id) }))
}
