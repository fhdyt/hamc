import type { SessionRow } from '@shared/events'
import type { QueryResult } from '@shared/ipc'
import type { ExportExt, ExportResult, SessionAction, SessionActionResult } from '@shared/sessions'
import { saveSetting } from './actions'
import { resumeSession } from './chatActions'
import { describeQueryError } from './lib/queryError'
import { exportName, toHtml, toJsonl, toMarkdown } from './lib/sessionExport'
import { rowKey, toArgs, type SessionQuery } from './lib/sessions'
import { useAgents } from './stores/agents'
import { useChat } from './stores/chat'
import { useGroups } from './stores/groups'
import { useSessions } from './stores/sessions'
import { useUi } from './stores/ui'

const PAGE = 50
const SEARCH_LIMIT = 200
const TRANSCRIPT_PAGE = 200
export const EXPORT_MAX_PAGES = 50

let listSeq = 0
let openSeq = 0

const knownProfiles = (): string[] => useAgents.getState().agents.map((a) => a.profile)
const nowSec = (): number => Date.now() / 1000
const errorText = <T,>(res: Extract<QueryResult<T>, { ok: false }>): string => describeQueryError(res.error, res.detail)

function fetchPage(query: SessionQuery, before?: { ts: number | null; id: string }) {
  const args = toArgs(query, knownProfiles(), nowSec())
  const q = query.q.trim()
  return q ? window.mc.sessions.search({ ...args, q, limit: SEARCH_LIMIT }) : window.mc.sessions.list({ ...args, ...(before ? { before } : {}), limit: PAGE })
}

/** Loads the first page for the current query. Rows already on screen stay until the answer arrives. */
export async function loadList(): Promise<void> {
  const st = useSessions.getState()
  if (st.status === 'idle') {
    const s = useUi.getState().settings
    st.setQuery({ agent: s['filters.agent'], range: s['filters.range'] })
  }
  const my = ++listSeq
  useSessions.getState().setStatus('loading')
  const res = await fetchPage(useSessions.getState().query)
  if (my !== listSeq) return
  if (res.ok) useSessions.getState().applyList(res.data, 'replace')
  else useSessions.getState().setError(errorText(res))
}

/** A quiet re-read of the first page, used by the timer while the screen is shown. Rows stay if it fails. */
export async function refreshList(): Promise<void> {
  const st = useSessions.getState()
  if (st.query.q.trim() !== '' || st.status === 'loading' || st.status === 'idle') return
  const my = ++listSeq
  const res = await fetchPage(st.query)
  if (my !== listSeq) return
  if (res.ok) useSessions.getState().applyList(res.data, 'head')
  else useSessions.getState().setError(errorText(res))
}

export async function loadMore(): Promise<void> {
  const st = useSessions.getState()
  const last = st.rows[st.rows.length - 1]
  if (!st.more || st.query.q.trim() !== '' || !last || st.loadingMore) return
  st.setLoadingMore(true)
  const my = listSeq
  const res = await fetchPage(st.query, { ts: last.startedAt, id: last.id })
  if (my !== listSeq) return
  if (res.ok) useSessions.getState().applyList(res.data, 'append')
  else useSessions.getState().setError(errorText(res))
}

/** A new filter or search text. The agent and range are shared with the other screens, so they are saved. */
export async function setQuery(patch: Partial<SessionQuery>): Promise<void> {
  const s = useSessions.getState()
  s.setQuery(patch)
  s.clearList()
  if (patch.agent !== undefined) await saveSetting('filters.agent', patch.agent)
  if (patch.range !== undefined) await saveSetting('filters.range', patch.range)
  await loadList()
}

export async function openSession(profile: string, id: string): Promise<void> {
  const my = ++openSeq
  useSessions.getState().select({ profile, id })
  const res = await window.mc.sessions.transcript({ profile, sessionId: id, limit: TRANSCRIPT_PAGE })
  if (my !== openSeq) return
  if (res.ok) useSessions.getState().applyTranscript(res.data, false)
  else useSessions.getState().setTranscriptError(errorText(res))
}

export async function loadMoreTranscript(): Promise<void> {
  const { selected, transcript } = useSessions.getState()
  if (!selected || transcript.nextAfter === null || transcript.loadingMore) return
  useSessions.getState().setTranscriptLoadingMore(true)
  const my = openSeq
  const res = await window.mc.sessions.transcript({ profile: selected.profile, sessionId: selected.id, afterId: transcript.nextAfter, limit: TRANSCRIPT_PAGE })
  if (my !== openSeq) return
  if (res.ok) useSessions.getState().applyTranscript(res.data, true)
  else useSessions.getState().setTranscriptError(errorText(res))
}

const DONE: Record<SessionAction, string> = { pin: 'Session pinned', unpin: 'Session unpinned', rename: 'Session renamed' }

/** Pin, unpin or rename through the Hermes CLI (the caller already showed the command and got a yes). */
export async function runAction(action: SessionAction, row: SessionRow, title?: string): Promise<SessionActionResult> {
  const res = await window.mc.sessions.action({ action, profile: row.profile, sessionId: row.id, ...(title !== undefined ? { title } : {}) })
  if (res.ok) {
    const st = useSessions.getState()
    st.patchRow(rowKey(row), action === 'rename' ? { title: title?.trim() ?? row.title } : { pinned: action === 'pin' })
    st.setNotice({ kind: 'ok', text: DONE[action] })
    void refreshList()
  }
  return res
}

/** Reads the whole transcript page by page and hands the built file to the main process, which asks where to save it. */
export async function exportSession(row: SessionRow, ext: ExportExt): Promise<{ result: ExportResult; truncated: boolean }> {
  const items = []
  let after: number | undefined
  let truncated = false
  for (let page = 0; ; page++) {
    const res = await window.mc.sessions.transcript({ profile: row.profile, sessionId: row.id, ...(after !== undefined ? { afterId: after } : {}), limit: TRANSCRIPT_PAGE })
    if (!res.ok) return { result: { failed: errorText(res) }, truncated: false }
    items.push(...res.data.items)
    if (res.data.nextAfter === null) break
    if (page + 1 >= EXPORT_MAX_PAGES) {
      truncated = true
      break
    }
    after = res.data.nextAfter
  }
  const content = ext === 'jsonl' ? toJsonl(row, items) : ext === 'md' ? toMarkdown(row, items) : toHtml(row, items)
  const result = await window.mc.sessions.export({ name: exportName(row), ext, content })
  return { result, truncated }
}

/** Opens the conversation of this session in Chat, which resumes it with `--resume`. */
export async function continueInChat(row: SessionRow): Promise<void> {
  useAgents.getState().select(row.profile)
  useChat.getState().setCurrent(row.profile)
  useGroups.getState().setCurrent(null)
  await resumeSession(row.profile, row.id)
  useUi.getState().navigate('chat')
}
