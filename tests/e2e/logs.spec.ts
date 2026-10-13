import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addLogs, appendLog, buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, resizeWindow, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-logs-ud-')
let app: ElectronApplication
let page: Page
let treeBefore: ReturnType<typeof snapshotTree>

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-logs-fx-'), 'fx'))
  addLogs(fx.root)
  treeBefore = snapshotTree(fx.root)
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const p2 = (n: number): string => String(n).padStart(2, '0')
const stamp = (d = new Date()): string => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())},123`

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const filters = () => page.getByRole('search', { name: 'Log filters' })
const rows = () => page.getByRole('list', { name: 'Log lines' }).getByRole('listitem')
const chip = (name: string) => filters().getByRole('group', { name: 'Levels' }).getByRole('button', { name, exact: true })

test('the Logs screen shows the lines of the agent with their levels, and DEBUG starts hidden', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await mainNav().getByRole('button', { name: /^Logs/ }).click()
  await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true')
  await expect(rows().filter({ hasText: 'session started s-default-1' })).toBeVisible({ timeout: 20_000 })
  await expect(rows().filter({ hasText: 'command failed with exit code 2' })).toContainText('ERROR')
  await expect(rows().filter({ hasText: 'loaded 12 tools' })).toHaveCount(0)
  await expect(chip('DEBUG')).toHaveAttribute('aria-pressed', 'false')
  await chip('DEBUG').click()
  await expect(rows().filter({ hasText: 'loaded 12 tools' })).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/logs.png' })
  await chip('DEBUG').click()
})

test('Follow shows a line that was written after the screen opened', async () => {
  appendLog(fx.root, 'default', 'agent.log', `${stamp()} INFO agent.run: appended by the follow test`)
  await expect(rows().filter({ hasText: 'appended by the follow test' })).toBeVisible({ timeout: 15_000 })
})

test('search highlights, a component narrows, and a row opens to its whole text', async () => {
  await filters().getByLabel('Search the log').fill('FAILED')
  await expect(rows()).toHaveCount(1)
  await expect(rows().first().locator('mark')).toHaveText('failed')
  await rows().first().getByRole('button').click()
  await expect(rows().first().locator('pre')).toContainText('Traceback line that belongs to the error above')
  await filters().getByLabel('Search the log').fill('')
  await filters().getByLabel('Component').selectOption('agent.tools')
  await expect(rows()).toHaveCount(0)
  await filters().getByLabel('Component').selectOption('tools.terminal')
  await expect(rows()).toHaveCount(1)
  await filters().getByLabel('Component').selectOption('all')
})

test('another file and a shorter range show only what fits', async () => {
  await filters().getByLabel('Log file').selectOption('errors.log')
  await expect(rows().filter({ hasText: 'telegram polling failed' })).toBeVisible()
  await filters().getByLabel('Time range').selectOption('15m')
  await expect(rows().filter({ hasText: 'provider returned 402' })).toBeVisible()
  await expect(rows().filter({ hasText: 'telegram polling failed' })).toHaveCount(0)
  await filters().getByLabel('Time range').selectOption('24h')
})

test('another agent shows its own files', async () => {
  await filters().getByLabel('Agent').selectOption('scout')
  await expect(filters().getByLabel('Log file')).toHaveValue('gateway.log', { timeout: 15_000 })
  await expect(rows().filter({ hasText: 'telegram connected' })).toBeVisible()
  await filters().getByLabel('Agent').selectOption('default')
  await expect(filters().getByLabel('Log file')).toHaveValue('agent.log', { timeout: 15_000 })
})

test('secrets are masked on screen and in the copied text', async () => {
  appendLog(fx.root, 'default', 'agent.log', `${stamp()} WARNING agent.run: provider said api_key=supersecretvalue123 and Bearer abcdef1234567890XYZ`)
  const row = rows().filter({ hasText: 'provider said' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row).toContainText('[redacted]')
  await expect(page.getByText('supersecretvalue123')).toHaveCount(0)
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await page.getByRole('button', { name: /Copy/ }).click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5000 }).toContain('[redacted]')
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied).not.toContain('supersecretvalue123')
  expect(copied).not.toContain('abcdef1234567890XYZ')
})

// The Gateway and Approvals tabs, the badge, the alerts and the closing checks are added in later tasks.
void resizeWindow
void treeBefore
