import { describe, expect, it } from 'vitest'
import { KanbanBoards, KanbanTaskDetail, KanbanTasks } from '@shared/events'
import { ALWAYS_COLUMNS, BOARD_RE, COLUMN_IDS, COLUMN_LABEL, TASK_ID_RE } from '@shared/kanban'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '@shared/settings'

const task = {
  id: 't_ab12', title: 'Draft', assignee: 'scout', createdBy: 'atlas', status: 'running', priority: 0, createdAt: 100, startedAt: 110, completedAt: null,
  comments: 2, parents: 1, children: 0, blockKind: null, failures: 0, failed: false
}

describe('kanban schemas', () => {
  it('parse the boards, the tasks of a board and one task', () => {
    const boards = { boards: [{ slug: 'default', path: 'kanban.db', tasks: 3, archived: 1, byStatus: { done: 3 }, readable: true }], errors: [{ slug: 'old', code: 'db_unreadable' }] }
    expect(KanbanBoards.parse(boards).boards[0]!.byStatus).toEqual({ done: 3 })
    expect(KanbanTasks.parse({ board: 'default', tasks: [task], archived: 0, truncated: false }).tasks).toHaveLength(1)
    const detail = {
      task: { ...task, body: '# hi', result: null, lastFailureError: null, skills: null, modelOverride: null, providerOverride: null, sessionId: 's1' },
      comments: [{ id: 1, author: 'atlas', body: 'ok', createdAt: 120 }],
      runs: [{ id: 1, profile: 'scout', stepKey: null, status: 'done', startedAt: 110, endedAt: 130, outcome: 'completed', summary: 's', error: null }],
      parents: [{ id: 't_0', title: 'before', status: 'done' }],
      children: [],
      events: [{ id: 1, runId: 1, kind: 'created', payload: '{}', createdAt: 100 }],
      attachments: [{ id: 1, filename: 'a.txt', size: 10, uploadedBy: 'atlas', createdAt: 101 }]
    }
    expect(KanbanTaskDetail.parse(detail).comments[0]!.author).toBe('atlas')
  })
  it('accept a task without any of the optional parts', () => {
    const bare = { id: 'x', title: null, assignee: null, createdBy: null, status: 'todo', priority: 0, createdAt: null, startedAt: null, completedAt: null, comments: 0, parents: 0, children: 0, blockKind: null, failures: 0, failed: false }
    expect(KanbanTasks.parse({ board: 'b', tasks: [bare], archived: 0, truncated: false }).tasks[0]!.title).toBeNull()
  })
})

describe('kanban constants', () => {
  it('names the columns, with the seven of the PRD always shown and scheduled only when used', () => {
    expect(ALWAYS_COLUMNS).toEqual(['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'done'])
    expect(COLUMN_IDS).toContain('scheduled')
    expect(COLUMN_LABEL['todo']).toBe('To do')
    expect(COLUMN_LABEL['other']).toBe('Other')
  })
  it('checks board and task names', () => {
    expect(BOARD_RE.test('sim-kanban')).toBe(true)
    expect(BOARD_RE.test('../x')).toBe(false)
    expect(TASK_ID_RE.test('t_ab12-cd')).toBe(true)
    expect(TASK_ID_RE.test('a b')).toBe(false)
  })
})

describe('kanban setting', () => {
  it('has the board with a default and a name check', () => {
    expect(SETTINGS_DEFAULTS['kanban.board']).toBe('')
    expect(SETTINGS_SCHEMA['kanban.board'].safeParse('').success).toBe(true)
    expect(SETTINGS_SCHEMA['kanban.board'].safeParse('sim-kanban').success).toBe(true)
    expect(SETTINGS_SCHEMA['kanban.board'].safeParse('../x').success).toBe(false)
  })
})
