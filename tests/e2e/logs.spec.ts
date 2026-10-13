import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addLogs, appendLog, buildFixture, setGateway, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, resizeWindow, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-logs-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-logs-fx-'), 'fx'))
  addLogs(fx.root)
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

test('the Approvals tab shows the policy, the suggestions and what Hermes does not keep', async () => {
  await page.getByRole('tab', { name: 'Approvals' }).click()
  const policy = page.getByRole('table', { name: 'Policy of default' })
  await expect(policy).toContainText('manual', { timeout: 15_000 })
  await expect(policy.getByRole('row', { name: /^timeout/ })).toContainText('60')
  await expect(policy.getByRole('row', { name: /^deny/ })).toContainText('rm -rf /')
  await expect(page.getByRole('list', { name: 'Suggestions for default' })).toContainText('terminal: git status (approved 14 times)')
  await expect(page.getByRole('button', { name: 'Copy command 1 of default' })).toBeVisible()
  await expect(page.getByText(/Hermes keeps no log of approve and deny decisions/)).toBeVisible()
  await expect(page.getByText(/never uses --yolo/)).toBeVisible()
})

test('the Logs item of the sidebar counts the errors of the last hour', async () => {
  await expect(mainNav().getByRole('button', { name: /^Logs/ })).toHaveAttribute('aria-label', 'Logs, 2 errors in the last hour', { timeout: 30_000 })
})

test('the palette action opens the errors of the last hour', async () => {
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox').fill('errors from the last hour')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true')
  await expect(filters().getByLabel('Log file')).toHaveValue('errors.log', { timeout: 15_000 })
  await expect(filters().getByLabel('Time range')).toHaveValue('1h')
  await expect(chip('ERROR')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip('CRITICAL')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip('INFO')).toHaveAttribute('aria-pressed', 'false')
  await expect(rows().filter({ hasText: 'provider returned 402' })).toBeVisible()
  await expect(rows().filter({ hasText: 'telegram polling failed' })).toBeVisible()
  await expect(rows().filter({ hasText: 'an old failure' })).toHaveCount(0)
})

const activity = () => page.locator('section.card[aria-label="Activity"]')

test('a gateway problem is a GATEWAY row in the Dashboard alerts, and the Settings switch hides it', async () => {
  setGateway(fx.root, 'scout', 'running', 'telegram', 'fatal', 'auth')
  await mainNav().getByRole('button', { name: /^Dashboard/ }).click()
  await activity().getByRole('tab', { name: /^alerts/ }).click()
  const row = activity().getByRole('listitem', { name: /^GATEWAY: Scout/ })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toContainText('telegram fatal (auth)')
  await row.click()
  await expect(page.getByRole('tab', { name: /^Gateway/ })).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('tab', { name: 'Alerts' }).click()
  const sw = dialog.getByRole('switch', { name: /gateway stops or a platform fails/ })
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await sw.click()
  await page.keyboard.press('Escape')
  await mainNav().getByRole('button', { name: /^Dashboard/ }).click()
  await activity().getByRole('tab', { name: /^alerts/ }).click()
  await expect(activity().getByRole('listitem', { name: /^GATEWAY:/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Alerts' }).click()
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('switch', { name: /gateway stops or a platform fails/ }).click()
  await page.keyboard.press('Escape')
  setGateway(fx.root, 'scout', 'running', 'telegram', 'connected')
  await expect(activity().getByRole('listitem', { name: /^GATEWAY:/ })).toHaveCount(0, { timeout: 30_000 })
})

test('on a narrow window the Logs screen does not scroll sideways', async () => {
  await resizeWindow(app, 800, 700)
  await mainNav().getByRole('button', { name: /^Logs/ }).click()
  await page.getByRole('tab', { name: 'Logs' }).click()
  await expect(rows().first()).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await page.getByRole('tab', { name: 'Gateway' }).click()
  await expect(gwCard('default')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  await resizeWindow(app, 1280, 800)
})

test('reading logs, gateways and approvals only ever ran read-only commands, apart from the confirmed gateway actions', async () => {
  const verbs = new Set(srv.execLog.map((a) => a[0]))
  for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat', 'tail']) expect(verbs.has(bad)).toBe(false)
  const hermes = srv.execLog.filter((a) => a[0]?.endsWith('/hermes'))
  const writes = hermes.filter((a) => a.includes('gateway')).map((a) => a.slice(a.indexOf('gateway')).join(' '))
  // one restart, and the stop twice: the first attempt was made to fail on purpose
  expect(writes.sort()).toEqual(['gateway restart', 'gateway stop', 'gateway stop'])
})
