import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addRealKanban, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, resizeWindow, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-kb-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-kb-fx-'), 'fx'))
  addRealKanban(fx.root)
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const card = (id: string) => page.getByRole('button', { name: new RegExp(`^Task ${id}:`) })
const column = (name: string) => page.getByRole('listitem', { name: new RegExp(`^${name}, \\d+ tasks?$`) })
const dialog = (id: string) => page.getByRole('dialog', { name: `Task ${id}` })

test('Kanban opens from the sidebar on the first board that has tasks, with every column and card', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await mainNav().getByRole('button', { name: /^Kanban/ }).click()
  await expect(page.getByRole('heading', { name: 'Kanban', level: 1 })).toBeVisible()
  await expect(page.getByLabel('Board', { exact: true })).toHaveValue('sim-kanban', { timeout: 20_000 })
  await expect(page.getByText(/8 tasks · 1 running · 1 blocked/)).toBeVisible()
  for (const name of ['Triage', 'To do', 'Ready', 'Running', 'Blocked', 'Scheduled', 'Review', 'Done', 'Other']) await expect(column(name)).toBeVisible()
  await expect(column('Running').getByRole('button', { name: /^Task t_run1: Draft the weekly digest/ })).toBeVisible()
  await expect(column('Blocked')).toContainText('human')
  await expect(column('Blocked')).toContainText('failed ×2')
  await expect(column('Other')).toContainText('weird')
  await expect(column('Running')).toContainText('P1')
  await expect(card('t_arc1')).toHaveCount(0)
  await expect(page.getByText('1 archived task is hidden.')).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/kanban.png' })
})

test('the other board is empty, and the choice is remembered', async () => {
  await page.getByLabel('Board', { exact: true }).selectOption('default')
  await expect(page.getByText('No tasks on this board')).toBeVisible()
  await page.getByLabel('Board', { exact: true }).selectOption('sim-kanban')
  await expect(card('t_run1')).toBeVisible()
})

test('the assignee filter and the search narrow the cards', async () => {
  await page.getByLabel('Assignee').selectOption('scout')
  await expect(card('t_run1')).toBeVisible()
  await expect(card('t_rev1')).toHaveCount(0)
  await page.getByLabel('Assignee').selectOption('__none__')
  await expect(card('t_todo1')).toBeVisible()
  await expect(card('t_run1')).toHaveCount(0)
  await page.getByLabel('Assignee').selectOption('all')
  await page.getByLabel('Search tasks').fill('invoices')
  await expect(card('t_tri1')).toBeVisible()
  await expect(card('t_run1')).toHaveCount(0)
  await page.getByLabel('Search tasks').fill('')
  await expect(card('t_run1')).toBeVisible()
})

test('a card opens its dialog with the body, comments, runs, links and activity', async () => {
  await card('t_run1').click()
  const d = dialog('t_run1')
  await expect(d).toBeVisible()
  await expect(d).toContainText('Draft the digest from')
  await expect(d.locator('strong', { hasText: '3 notes' })).toBeVisible()
  await expect(d.getByRole('region', { name: 'Comments' })).toContainText('Please keep it under 120 words.')
  await expect(d.getByRole('region', { name: 'Comments' })).toContainText('On it.')
  await expect(d.getByRole('region', { name: 'Runs' })).toContainText('running')
  await expect(d.getByRole('region', { name: 'Activity' })).toContainText('claimed')
  await expect(d.getByRole('region', { name: 'Activity' })).toContainText('profile: scout')
  await expect(d.getByRole('region', { name: 'Attachments' })).toContainText('notes.txt')
  await expect(d.getByRole('complementary', { name: 'Task details' })).toContainText('m-x')
  await page.screenshot({ path: 'tests/e2e/shots/kanban-task.png' })
})

test('a linked task opens in the same dialog and Back returns', async () => {
  await dialog('t_run1').getByRole('button', { name: /^Waits for t_done1/ }).click()
  await expect(dialog('t_done1')).toBeVisible()
  await expect(dialog('t_done1')).toContainText('6 sources found')
  await expect(dialog('t_done1').getByRole('region', { name: 'Result' })).toContainText('6 sources')
  await dialog('t_done1').getByRole('button', { name: 'Back' }).click()
  await expect(dialog('t_run1')).toBeVisible()
})

test('Open session shows the transcript of the task session on top of the dialog', async () => {
  await dialog('t_run1').getByRole('button', { name: 'Open session' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the command palette opens Kanban and a narrow window scrolls the board sideways', async () => {
  await mainNav().getByRole('button', { name: /^Dashboard/ }).click()
  await page.keyboard.press('Control+K')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await palette.getByRole('combobox').fill('kanban')
  await expect(palette.getByRole('option', { name: /Kanban/ })).not.toContainText('Coming in a later release')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Kanban', level: 1 })).toBeVisible()
  await resizeWindow(app, 900, 700)
  await expect(column('Done')).toBeAttached()
  const scrolls = await page.getByRole('list', { name: 'Board columns' }).evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(scrolls).toBe(true)
  await expect(page.getByLabel('Board', { exact: true })).toBeVisible()
  await resizeWindow(app, 1280, 800)
})

test('the agent graph opens a kanban task with a text id', async () => {
  await mainNav().getByRole('button', { name: /^Dashboard/ }).click()
  await page.getByRole('tab', { name: 'agents' }).click()
  const graph = page.locator('section[aria-label="Agent interactions"]')
  await graph.getByRole('button', { name: /^kanban, atlas to scout, #t_run1/ }).click()
  const detail = graph.getByLabel('Interaction details')
  await expect(detail).toContainText('On it.', { timeout: 15_000 })
  await expect(detail).toContainText('Draft the weekly digest')
})

test('a server without any kanban.db says so', async () => {
  const fx2 = buildFixture(join(tmp('mc-e2e-kb-fx2-'), 'fx'))
  const srv2 = await startFakeSsh({ fixture: fx2 })
  const second = await launchApp(tmp('mc-e2e-kb-ud2-'))
  try {
    await connectFresh(second.page, srv2)
    await second.page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Kanban/ }).click()
    await expect(second.page.getByText('No Kanban board found')).toBeVisible({ timeout: 20_000 })
    await expect(second.page.getByText(/no kanban\.db was found/)).toBeVisible()
  } finally {
    await second.app.close().catch(() => {})
    await srv2.close()
  }
})
