import { describe, expect, it } from 'vitest'
import { kanbanActionArgs, kanbanCommandPreview, type KanbanActionRequest } from '@shared/kanban'
import { actionsFor, confirmText, newTaskProblem } from '../../src/renderer/lib/kanbanControl'

const base = { board: 'default', id: 't_abc' }

describe('kanbanActionArgs', () => {
  it('builds every verb with --board first and text after --', () => {
    const cases: [KanbanActionRequest, string[]][] = [
      [{ action: 'create', board: 'sim-kanban', title: 'Write the digest', body: 'Use 3 notes', assignee: 'scout', priority: 2, triage: false }, ['kanban', '--board', 'sim-kanban', 'create', '--json', '--body=Use 3 notes', '--assignee=scout', '--priority=2', '--', 'Write the digest']],
      [{ action: 'create', board: 'default', title: 'Idea', triage: true }, ['kanban', '--board', 'default', 'create', '--json', '--triage', '--', 'Idea']],
      [{ action: 'assign', ...base, assignee: 'atlas' }, ['kanban', '--board', 'default', 'assign', 't_abc', 'atlas']],
      [{ action: 'assign', ...base, assignee: 'none' }, ['kanban', '--board', 'default', 'assign', 't_abc', 'none']],
      [{ action: 'comment', ...base, text: 'Looks good\nship it' }, ['kanban', '--board', 'default', 'comment', 't_abc', '--', 'Looks good\nship it']],
      [{ action: 'complete', ...base, result: 'Done in 2 steps' }, ['kanban', '--board', 'default', 'complete', 't_abc', '--result=Done in 2 steps']],
      [{ action: 'complete', ...base }, ['kanban', '--board', 'default', 'complete', 't_abc']],
      [{ action: 'block', ...base, reason: 'need the API key' }, ['kanban', '--board', 'default', 'block', 't_abc', '--', 'need the API key']],
      [{ action: 'block', ...base }, ['kanban', '--board', 'default', 'block', 't_abc']],
      [{ action: 'unblock', ...base }, ['kanban', '--board', 'default', 'unblock', 't_abc']],
      [{ action: 'promote', ...base }, ['kanban', '--board', 'default', 'promote', 't_abc']],
      [{ action: 'archive', ...base }, ['kanban', '--board', 'default', 'archive', 't_abc']]
    ]
    for (const [req, argv] of cases) expect(kanbanActionArgs(req), req.action).toEqual(argv)
  })

  it('keeps text that starts with a dash out of the options', () => {
    expect(kanbanActionArgs({ action: 'create', board: 'default', title: '--yolo', body: '-x' })).toEqual(['kanban', '--board', 'default', 'create', '--json', '--body=-x', '--', '--yolo'])
    expect(kanbanActionArgs({ action: 'comment', ...base, text: '-1' })).toEqual(['kanban', '--board', 'default', 'comment', 't_abc', '--', '-1'])
  })

  it('refuses what Hermes or the rules would not take', () => {
    const bad: KanbanActionRequest[] = [
      { action: 'archive', board: 'Sim.Kanban', id: 't_abc' },
      { action: 'archive', board: '-x', id: 't_abc' },
      { action: 'archive', board: 'default', id: '../x' },
      { action: 'archive', board: 'default', id: '-t' },
      { action: 'assign', ...base, assignee: '-p' },
      { action: 'assign', ...base, assignee: '' },
      { action: 'create', board: 'default', title: '' },
      { action: 'create', board: 'default', title: '   ' },
      { action: 'create', board: 'default', title: 'a'.repeat(201) },
      { action: 'create', board: 'default', title: 'two\nlines' },
      { action: 'create', board: 'default', title: 'ok', body: 'b'.repeat(16_001) },
      { action: 'create', board: 'default', title: 'ok', priority: 1001 },
      { action: 'create', board: 'default', title: 'ok', priority: 1.5 },
      { action: 'create', board: 'default', title: 'ok', assignee: 'a b' },
      { action: 'comment', ...base, text: '' },
      { action: 'comment', ...base, text: 'x'.repeat(8001) },
      { action: 'comment', ...base, text: 'nul\u0000' },
      { action: 'block', ...base, reason: 'r'.repeat(501) },
      { action: 'block', ...base, reason: 'a\nb' },
      { action: 'complete', ...base, result: 'r'.repeat(2001) }
    ]
    for (const r of bad) expect(kanbanActionArgs(r), JSON.stringify(r).slice(0, 80)).toBeNull()
  })

  it('previews the command the way a shell would read it', () => {
    expect(kanbanCommandPreview({ action: 'comment', ...base, text: "it's fine" })).toBe(`$ hermes kanban --board default comment t_abc -- 'it'\\''s fine'`)
    expect(kanbanCommandPreview({ action: 'archive', ...base })).toBe('$ hermes kanban --board default archive t_abc')
    expect(kanbanCommandPreview({ action: 'archive', board: 'X', id: 't' })).toBeNull()
  })
})

describe('actionsFor', () => {
  const t = (status: string) => ({ status })
  it('offers what each status allows', () => {
    expect(actionsFor(t('triage'))).toEqual(['complete', 'block', 'archive'])
    expect(actionsFor(t('todo'))).toEqual(['complete', 'block', 'promote', 'archive'])
    expect(actionsFor(t('ready'))).toEqual(['complete', 'block', 'archive'])
    expect(actionsFor(t('running'))).toEqual(['complete', 'block', 'archive'])
    expect(actionsFor(t('blocked'))).toEqual(['complete', 'unblock', 'promote', 'archive'])
    expect(actionsFor(t('scheduled'))).toEqual(['complete', 'block', 'unblock', 'archive'])
    expect(actionsFor(t('review'))).toEqual(['complete', 'block', 'archive'])
    expect(actionsFor(t('done'))).toEqual(['archive'])
    expect(actionsFor(t('archived'))).toEqual([])
    expect(actionsFor(t('weird'))).toEqual(['complete', 'archive'])
  })

  it('warns when a worker holds the task', () => {
    expect(confirmText('complete', { status: 'running', title: 'Draft', assignee: 'scout' })).toMatch(/scout is working on it/)
    expect(confirmText('archive', { status: 'done', title: 'Draft', assignee: null })).toBe('Archive "Draft"? It leaves the board; Hermes keeps it in kanban.db.')
  })
})

describe('newTaskProblem', () => {
  it('names the first problem of the form', () => {
    expect(newTaskProblem({ title: '', body: '', priority: '' })).toBe('Give the task a title.')
    expect(newTaskProblem({ title: 'x'.repeat(201), body: '', priority: '' })).toBe('Keep the title under 200 characters.')
    expect(newTaskProblem({ title: 'ok', body: '', priority: 'high' })).toBe('Priority is a whole number from -1000 to 1000.')
    expect(newTaskProblem({ title: 'ok', body: '', priority: '3' })).toBeNull()
  })
})
