import { saveSetting } from './actions'
import { pickBoard } from './lib/kanban'
import { describeQueryError } from './lib/queryError'
import { useKanban } from './stores/kanban'
import { useUi } from './stores/ui'

let seq = 0
let detailSeq = 0

/**
 * Reads the board list and the tasks of the current board. `quiet` is the timer's refresh: nothing flips to loading and a failure
 * leaves the cards on screen (the screen shows a stale banner from `error`).
 */
async function load(quiet: boolean): Promise<void> {
  const my = ++seq
  const st = useKanban.getState()
  if (!quiet && st.tasks.length === 0) st.setStatus('loading')
  const boards = await window.mc.kanban.boards()
  if (my !== seq) return
  if (!boards.ok) {
    useKanban.getState().setError(describeQueryError(boards.error, boards.detail))
    return
  }
  useKanban.getState().applyBoards(boards.data)
  const list = boards.data.boards
  const current = useKanban.getState().board
  const saved = useUi.getState().settings['kanban.board']
  let board = current ?? pickBoard(list, saved)
  if (board !== null && !list.some((b) => b.slug === board)) {
    const next = pickBoard(list, 'default')
    useKanban.getState().setBoard(next, next ? `The board "${board}" is no longer on the server. Showing "${next}".` : null)
    board = next
  } else if (board !== current) {
    useKanban.getState().setBoard(board)
  }
  if (board === null) {
    useKanban.setState({ status: 'ok', error: null, tasks: [], archived: 0, truncated: false })
    return
  }
  const tasks = await window.mc.kanban.tasks({ board })
  if (my !== seq) return
  if (tasks.ok) useKanban.getState().applyTasks(board, tasks.data)
  else useKanban.getState().setError(describeQueryError(tasks.error, tasks.detail))
}

/** Opens the screen: boards first, then the saved board (or the first one with tasks). */
export const openKanban = (): Promise<void> => load(false)

/** The timer's quiet refresh; an open dialog is refreshed with it. */
export async function refreshKanban(): Promise<void> {
  await load(true)
  if (useKanban.getState().selectedId) await refreshTask()
}

export const retryKanban = (): Promise<void> => load(false)

/** Another board; the choice is remembered. */
export async function selectBoard(slug: string): Promise<void> {
  useKanban.getState().setBoard(slug)
  await saveSetting('kanban.board', slug)
  await load(false)
}

async function readTask(my: number, quiet: boolean): Promise<void> {
  const { board, selectedId } = useKanban.getState()
  if (!board || !selectedId) return
  const id = selectedId
  const res = await window.mc.kanban.task({ board, id })
  if (my !== detailSeq || useKanban.getState().selectedId !== id) return
  const st = useKanban.getState()
  if (res.ok) st.setDetail({ status: 'ok', data: res.data })
  else if (res.error === 'not_found') st.setDetail({ status: 'gone' })
  else if (!quiet || st.detail?.status !== 'ok') st.setDetail({ status: 'error', message: describeQueryError(res.error, res.detail) })
}

export function openTask(id: string): Promise<void> {
  useKanban.getState().openTask(id)
  return readTask(++detailSeq, false)
}

export function taskBack(): Promise<void> {
  useKanban.getState().back()
  return readTask(++detailSeq, false)
}

export function retryTask(): Promise<void> {
  useKanban.getState().setDetail({ status: 'loading' })
  return readTask(++detailSeq, false)
}

export function refreshTask(): Promise<void> {
  return readTask(++detailSeq, true)
}

export function closeTask(): void {
  detailSeq++
  useKanban.getState().closeTask()
}
