import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addLogs, appendLog, buildFixture, setGateway, snapshotTree, type FixtureDirs } from '../helpers/fixture'
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

const gwCard = (name: string) => page.getByRole('region', { name: `Gateway of ${name}` })

test('the Gateway tab shows the state of every gateway and its platforms', async () => {
  await page.getByRole('tab', { name: 'Gateway' }).click()
  await expect(gwCard('default')).toContainText('running')
  await expect(gwCard('default')).toContainText('telegram · connected')
  await expect(gwCard('Scout')).toContainText('running')
  await expect(gwCard('atlas')).toContainText('no gateway data')
  await expect(gwCard('atlas').getByRole('button', { name: /Restart/ })).toBeDisabled()
})

test('Restart waits for a yes and then runs the command for that agent only', async () => {
  await gwCard('Scout').getByRole('button', { name: /Restart gateway/ }).click()
  const dlg = page.getByRole('dialog', { name: 'Restart gateway' })
  await expect(dlg.getByText('$ hermes -p scout gateway restart')).toBeVisible()
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  expect(srv.hermes.restarts).toEqual([])
  await gwCard('Scout').getByRole('button', { name: /Restart gateway/ }).click()
  await page.getByRole('dialog', { name: 'Restart gateway' }).getByRole('button', { name: 'Restart gateway' }).click()
  await expect(page.getByText('Restarted the gateway of Scout.')).toBeVisible()
  expect(srv.hermes.restarts).toEqual(['scout'])
})

test('Stop says what it does, runs the command and a failure stays in the dialog', async () => {
  await gwCard('default').getByRole('button', { name: /Stop gateway/ }).click()
  const dlg = page.getByRole('dialog', { name: 'Stop gateway' })
  await expect(dlg.getByText('$ hermes gateway stop')).toBeVisible()
  await expect(dlg.getByText(/stays offline until its gateway is started again/)).toBeVisible()
  srv.hermes.failOn['gateway'] = 'no gateway is running'
  await dlg.getByRole('button', { name: 'Stop gateway' }).click()
  await expect(dlg.getByRole('alert')).toHaveText('no gateway is running')
  delete srv.hermes.failOn['gateway']
  await dlg.getByRole('button', { name: 'Stop gateway' }).click()
  await expect(page.getByText('Stopped the gateway of default.')).toBeVisible()
  expect(srv.hermes.stops).toEqual(['default'])
})

test('a platform that fails shows up on its card and in the count of the tab, and clears when it recovers', async () => {
  setGateway(fx.root, 'scout', 'running', 'telegram', 'fatal', 'auth')
  await expect(gwCard('Scout')).toContainText('telegram · fatal (auth)', { timeout: 30_000 })
  await expect(page.getByRole('tab', { name: /^Gateway/ }).getByLabel('1 problem')).toBeVisible()
  setGateway(fx.root, 'scout', 'running', 'telegram', 'connected')
  await expect(gwCard('Scout')).toContainText('telegram · connected', { timeout: 30_000 })
  await expect(page.getByRole('tab', { name: /^Gateway/ }).getByLabel(/problem/)).toHaveCount(0)
})

// The Approvals tab, the badge, the alerts and the closing checks are added in later tasks.
void resizeWindow
void treeBefore
