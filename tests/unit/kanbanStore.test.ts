import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KanbanBoard, KanbanTask, KanbanTaskDetail } from '@shared/events'
import { SETTINGS_DEFAULTS } from '@shared/settings'
import { closeTask, openKanban, openTask, refreshKanban, selectBoard, taskBack } from '../../src/renderer/kanbanActions'
import { useKanban } from '../../src/renderer/stores/kanban'
import { useUi } from '../../src/renderer/stores/ui'

const ok = <T,>(data: T) => ({ ok: true as const, data })
const task = (id: string, over: Partial<KanbanTask> = {}): KanbanTask => ({
  id, title: `Task ${id}`, assignee: 'scout', createdBy: 'atlas', status: 'todo', priority: 0, createdAt: 100, startedAt: null, completedAt: null,
  comments: 0, parents: 0, children: 0, blockKind: null, failures: 0, failed: false, ...over
})
const board = (slug: string, tasks: number): KanbanBoard => ({ slug, path: `${slug}/kanban.db`, tasks, archived: 0, byStatus: {}, readable: true })
const tasksOf = (board: string, tasks: KanbanTask[]) => ok({ board, tasks, archived: 0, truncated: false })
const detailOf = (id: string): KanbanTaskDetail => ({
  task: { ...task(id), body: null, result: null, lastFailureError: null, skills: null, modelOverride: null, providerOverride: null, sessionId: null },
  comments: [], runs: [], parents: [], children: [], events: [], attachments: []
})

type Mc = { kanban: { boards: ReturnType<typeof vi.fn>; tasks: ReturnType<typeof vi.fn>; task: ReturnType<typeof vi.fn> }; settings: { set: ReturnType<typeof vi.fn> } }
function stub(over: Partial<Mc['kanban']> = {}): Mc {
  const mc: Mc = {
    kanban: {
      boards: vi.fn(async () => ok({ boards: [board('default', 0), board('sim', 3)], errors: [] })),
      tasks: vi.fn(async (a: { board: string }) => tasksOf(a.board, [task('a')])),
      task: vi.fn(async (a: { id: string }) => ok(detailOf(a.id))),
      ...over
    },
    settings: { set: vi.fn(async () => undefined) }
  }
  vi.stubGlobal('window', { mc })
  return mc
}

beforeEach(() => {
  useKanban.getState().reset()
  useUi.setState({ settings: { ...SETTINGS_DEFAULTS }, route: 'kanban' })
})
afterEach(() => vi.unstubAllGlobals())

describe('useKanban reducers', () => {
  it('drops the tasks and the filters of the old board when the board changes', () => {
    const s = useKanban.getState()
    s.setBoard('a')
    s.applyTasks('a', { board: 'a', tasks: [task('x')], archived: 1, truncated: false })
    s.setAssignee('scout')
    s.setQuery('zz')
    s.setBoard('b')
    expect(useKanban.getState()).toMatchObject({ board: 'b', tasks: [], assignee: 'all', query: '', archived: 0 })
  })

  it('ignores tasks that belong to another board than the open one', () => {
    const s = useKanban.getState()
    s.setBoard('a')
    s.applyTasks('zzz', { board: 'zzz', tasks: [task('x')], archived: 0, truncated: false })
    expect(useKanban.getState().tasks).toEqual([])
  })

  it('keeps the cards when an error arrives', () => {
    const s = useKanban.getState()
    s.setBoard('a')
    s.applyTasks('a', { board: 'a', tasks: [task('x')], archived: 0, truncated: false })
    s.setError('boom')
    expect(useKanban.getState()).toMatchObject({ status: 'error', error: 'boom', tasks: [expect.objectContaining({ id: 'x' })] })
  })

  it('remembers where a linked task was opened from and goes back', () => {
    const s = useKanban.getState()
    s.openTask('a')
    s.openTask('b')
    expect(useKanban.getState()).toMatchObject({ selectedId: 'b', trail: ['a'] })
    s.back()
    expect(useKanban.getState()).toMatchObject({ selectedId: 'a', trail: [] })
    s.closeTask()
    expect(useKanban.getState()).toMatchObject({ selectedId: null, detail: null })
  })
})

describe('opening the screen', () => {
  it('opens the first board that has tasks when nothing is saved', async () => {
    const mc = stub()
    await openKanban()
    expect(mc.kanban.tasks).toHaveBeenCalledWith({ board: 'sim' })
    expect(useKanban.getState()).toMatchObject({ board: 'sim', status: 'ok' })
    expect(useKanban.getState().tasks.map((t) => t.id)).toEqual(['a'])
  })

  it('opens the saved board', async () => {
    useUi.setState({ settings: { ...SETTINGS_DEFAULTS, 'kanban.board': 'default' } })
    const mc = stub()
    await openKanban()
    expect(mc.kanban.tasks).toHaveBeenCalledWith({ board: 'default' })
  })

  it('says there is no board when the server has none', async () => {
    stub({ boards: vi.fn(async () => ok({ boards: [], errors: [] })) })
    await openKanban()
    expect(useKanban.getState()).toMatchObject({ status: 'ok', board: null, tasks: [] })
  })

  it('reports an error from the board list', async () => {
    stub({ boards: vi.fn(async () => ({ ok: false as const, error: 'timeout' as const })) })
    await openKanban()
    expect(useKanban.getState()).toMatchObject({ status: 'error', error: 'The server took too long to answer.' })
  })

  it('drops an answer that arrives after a newer request', async () => {
    let release: (v: unknown) => void = () => undefined
    const slow = new Promise((r) => (release = r))
    const mc = stub()
    mc.kanban.tasks.mockImplementationOnce(async () => {
      await slow
      return tasksOf('sim', [task('old')])
    })
    const first = openKanban()
    await vi.waitFor(() => expect(mc.kanban.tasks).toHaveBeenCalledTimes(1))
    await openKanban()
    release(null)
    await first
    expect(useKanban.getState().tasks.map((t) => t.id)).toEqual(['a'])
  })
})

describe('switching and refreshing', () => {
  it('remembers the board that was picked and loads its tasks', async () => {
    const mc = stub()
    await openKanban()
    await selectBoard('default')
    expect(mc.settings.set).toHaveBeenCalledWith('kanban.board', 'default')
    expect(mc.kanban.tasks).toHaveBeenLastCalledWith({ board: 'default' })
    expect(useKanban.getState().board).toBe('default')
  })

  it('falls back to another board and says so when the open board disappears', async () => {
    const mc = stub()
    await openKanban()
    mc.kanban.boards.mockResolvedValueOnce(ok({ boards: [board('default', 0)], errors: [] }))
    await refreshKanban()
    expect(useKanban.getState().board).toBe('default')
    expect(useKanban.getState().notice).toContain('"sim" is no longer on the server')
  })

  it('keeps the cards on screen when a refresh fails', async () => {
    const mc = stub()
    await openKanban()
    mc.kanban.tasks.mockResolvedValueOnce({ ok: false, error: 'db_unreadable' })
    await refreshKanban()
    expect(useKanban.getState()).toMatchObject({ status: 'error', tasks: [expect.objectContaining({ id: 'a' })] })
  })

  it('refreshes the open dialog with the board', async () => {
    const mc = stub()
    await openKanban()
    await openTask('a')
    mc.kanban.task.mockClear()
    await refreshKanban()
    expect(mc.kanban.task).toHaveBeenCalledWith({ board: 'sim', id: 'a' })
  })
})

describe('the task dialog', () => {
  it('loads a task, follows a link and goes back', async () => {
    const mc = stub()
    await openKanban()
    await openTask('a')
    expect(useKanban.getState().detail).toMatchObject({ status: 'ok' })
    await openTask('b')
    expect(mc.kanban.task).toHaveBeenLastCalledWith({ board: 'sim', id: 'b' })
    await taskBack()
    expect(useKanban.getState().selectedId).toBe('a')
    closeTask()
    expect(useKanban.getState().selectedId).toBeNull()
  })

  it('says the task is gone when the server no longer has it, and keeps a loaded task on a failed refresh', async () => {
    const mc = stub()
    await openKanban()
    await openTask('a')
    mc.kanban.task.mockResolvedValueOnce({ ok: false, error: 'timeout' })
    await refreshKanban()
    expect(useKanban.getState().detail).toMatchObject({ status: 'ok' })
    mc.kanban.task.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    await refreshKanban()
    expect(useKanban.getState().detail).toEqual({ status: 'gone' })
  })

  it('shows an error when the first read of a task fails', async () => {
    const mc = stub()
    await openKanban()
    mc.kanban.task.mockResolvedValueOnce({ ok: false, error: 'db_unreadable' })
    await openTask('a')
    expect(useKanban.getState().detail).toEqual({ status: 'error', message: 'A database on the server could not be read.' })
  })
})
