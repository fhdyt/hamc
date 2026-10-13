import { describe, expect, it } from 'vitest'
import type { KanbanBoard, KanbanTask } from '@shared/events'
import {
  DONE_VISIBLE,
  ageLabel,
  assigneeOptions,
  boardSummary,
  buildColumns,
  columnOf,
  filterTasks,
  payloadSummary,
  pickBoard,
  priorityLabel,
  taskTitle
} from '../../src/renderer/lib/kanban'

const NOW = 1_000_000
const t = (id: string, over: Partial<KanbanTask> = {}): KanbanTask => ({
  id, title: `Task ${id}`, assignee: 'scout', createdBy: 'atlas', status: 'todo', priority: 0, createdAt: NOW - 1000, startedAt: null, completedAt: null,
  comments: 0, parents: 0, children: 0, blockKind: null, failures: 0, failed: false, ...over
})
const board = (slug: string, tasks: number): KanbanBoard => ({ slug, path: `${slug}/kanban.db`, tasks, archived: 0, byStatus: {}, readable: true })

describe('columnOf', () => {
  it('maps the named status words and sends anything else to other', () => {
    expect(columnOf('running')).toBe('running')
    expect(columnOf('Done')).toBe('done')
    expect(columnOf(' blocked ')).toBe('blocked')
    expect(columnOf('weird')).toBe('other')
    expect(columnOf('')).toBe('other')
  })
})

describe('buildColumns', () => {
  it('always has the seven columns, in order, and no scheduled or other when they are empty', () => {
    const cols = buildColumns([])
    expect(cols.map((c) => c.id)).toEqual(['triage', 'todo', 'ready', 'running', 'blocked', 'review', 'done'])
    expect(cols.every((c) => c.tasks.length === 0 && c.total === 0)).toBe(true)
  })

  it('adds scheduled before review and other at the end only when they have tasks', () => {
    const cols = buildColumns([t('a', { status: 'scheduled' }), t('b', { status: 'weird' })])
    expect(cols.map((c) => c.id)).toEqual(['triage', 'todo', 'ready', 'running', 'blocked', 'scheduled', 'review', 'done', 'other'])
    expect(cols.find((c) => c.id === 'other')!.tasks[0]!.id).toBe('b')
  })

  it('orders cards by priority first, then newest first, then id', () => {
    const cols = buildColumns([t('a', { createdAt: 10 }), t('b', { createdAt: 30 }), t('c', { createdAt: 20, priority: 2 }), t('d', { createdAt: 30 })])
    expect(cols.find((c) => c.id === 'todo')!.tasks.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('does not show archived tasks', () => {
    const cols = buildColumns([t('a', { status: 'archived' })])
    expect(cols.reduce((n, c) => n + c.total, 0)).toBe(0)
  })

  it('cuts the done column to 30 cards and says how many are hidden, until it is expanded', () => {
    const many = Array.from({ length: 45 }, (_, i) => t(`d${i}`, { status: 'done', createdAt: i }))
    const done = buildColumns(many).find((c) => c.id === 'done')!
    expect(DONE_VISIBLE).toBe(30)
    expect(done.tasks).toHaveLength(30)
    expect(done.total).toBe(45)
    expect(done.hidden).toBe(15)
    const open = buildColumns(many, true).find((c) => c.id === 'done')!
    expect(open.tasks).toHaveLength(45)
    expect(open.hidden).toBe(0)
  })
})

describe('filterTasks', () => {
  const tasks = [t('a', { assignee: 'scout' }), t('b', { assignee: null, title: 'Check Invoices' }), t('c', { assignee: 'atlas', createdBy: 'scout' })]
  it('filters by assignee, unassigned and text', () => {
    expect(filterTasks(tasks, 'all', '').map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(filterTasks(tasks, 'scout', '').map((x) => x.id)).toEqual(['a'])
    expect(filterTasks(tasks, '__none__', '').map((x) => x.id)).toEqual(['b'])
    expect(filterTasks(tasks, 'all', 'invoice').map((x) => x.id)).toEqual(['b'])
    expect(filterTasks(tasks, 'all', 'SCOUT').map((x) => x.id)).toEqual(['a', 'c'])
    expect(filterTasks(tasks, 'all', ' b ').map((x) => x.id)).toEqual(['b'])
  })
})

describe('assigneeOptions', () => {
  it('lists the assignees found, sorted, and whether some task has none', () => {
    expect(assigneeOptions([t('a', { assignee: 'scout' }), t('b', { assignee: 'atlas' }), t('c', { assignee: 'scout' }), t('d', { assignee: null })])).toEqual({ names: ['atlas', 'scout'], unassigned: true })
    expect(assigneeOptions([t('a')])).toEqual({ names: ['scout'], unassigned: false })
  })
})

describe('boardSummary', () => {
  it('counts the tasks, the running and the blocked ones', () => {
    expect(boardSummary([t('a', { status: 'running' }), t('b', { status: 'blocked' }), t('c', { status: 'blocked' }), t('d')])).toEqual({ total: 4, running: 1, blocked: 2 })
  })
})

describe('labels', () => {
  it('shows the priority only above zero', () => {
    expect(priorityLabel(0)).toBeNull()
    expect(priorityLabel(-1)).toBeNull()
    expect(priorityLabel(3)).toBe('P3')
  })

  it('ages a running task from its start and the others from their creation', () => {
    expect(ageLabel(t('a', { status: 'running', startedAt: NOW - 300 }), NOW)).toBe('5m ago')
    expect(ageLabel(t('b', { createdAt: NOW - 7200 }), NOW)).toBe('2h ago')
    expect(ageLabel(t('c', { createdAt: null }), NOW)).toBe('')
  })

  it('gives an untitled task a name', () => {
    expect(taskTitle(t('a', { title: null }))).toBe('(untitled)')
    expect(taskTitle(t('a', { title: '  ' }))).toBe('(untitled)')
    expect(taskTitle(t('a'))).toBe('Task a')
  })
})

describe('payloadSummary', () => {
  it('shows the keys of a JSON object, cut', () => {
    expect(payloadSummary('{"by": "atlas", "n": 3}')).toBe('by: atlas, n: 3')
    expect(payloadSummary('{"a": {"x": 1}, "b": [1,2]}')).toBe('a: {"x":1}, b: [1,2]')
    expect(payloadSummary('x'.repeat(300))).toHaveLength(121)
  })
  it('shows plain text as it is and nothing for an empty payload', () => {
    expect(payloadSummary('plain words')).toBe('plain words')
    expect(payloadSummary(null)).toBe('')
    expect(payloadSummary('')).toBe('')
    expect(payloadSummary('[1, 2]')).toBe('[1, 2]')
    expect(payloadSummary('{broken')).toBe('{broken')
  })
})

describe('pickBoard', () => {
  it('keeps the saved board when it exists, else the first with tasks, else default, else the first', () => {
    expect(pickBoard([board('default', 0), board('sim', 3)], 'default')).toBe('default')
    expect(pickBoard([board('default', 0), board('sim', 3)], 'gone')).toBe('sim')
    expect(pickBoard([board('default', 0), board('sim', 0)], 'gone')).toBe('default')
    expect(pickBoard([board('x', 0)], 'gone')).toBe('x')
    expect(pickBoard([], 'default')).toBeNull()
  })
  it('treats a board nobody picked yet (empty) like a missing one', () => {
    expect(pickBoard([board('default', 0), board('sim', 3)], '')).toBe('sim')
  })
  it('skips unreadable boards when it has to choose', () => {
    expect(pickBoard([{ ...board('bad', 9), readable: false }, board('ok', 1)], 'gone')).toBe('ok')
  })
})
