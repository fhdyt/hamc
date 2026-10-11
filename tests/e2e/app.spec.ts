import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { advanceFixture, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let fxDir: string
let ticker: NodeJS.Timeout
const userData = tmp('mc-e2e-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fxDir = join(tmp('mc-e2e-fx-'), 'fx')
  fx = buildFixture(fxDir)
  srv = await startFakeSsh({ fixture: fx })
  let step = 1
  ticker = setInterval(() => advanceFixture(fxDir, step++), 1000)
})
test.afterAll(async () => {
  clearInterval(ticker)
  await srv.close()
})
test.afterEach(async () => {
  await app?.close().catch(() => {})
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })

test('first run: verify host key, pass preflight, land on a live dashboard', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByText('first-time setup')).toBeVisible()
  await page.getByLabel('host / public ip').fill('127.0.0.1')
  await page.getByLabel('ssh port').fill(String(srv.port))
  await page.getByLabel(/^username/).fill('tester')
  await page.getByLabel(/^password/).fill('test-pass-123')
  await page.getByRole('button', { name: /TEST & CONNECT/ }).click()

  await expect(page.getByRole('alertdialog', { name: 'Host key verification' })).toBeVisible()
  await expect(page.getByText(srv.fingerprint)).toBeVisible()
  await page.getByRole('button', { name: /TRUST & CONTINUE/ }).click()

  await expect(page.getByText(/checks passed/)).toBeVisible({ timeout: 20_000 })
  await expect(mainNav()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/\d+\/3 agents online/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /^Scout, (working|idle)/ })).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/dashboard.png' })
})

test('the second launch connects on its own without showing the form', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByLabel('host / public ip')).toHaveCount(0)
})

test('server screen streams CPU, memory, disks and processes', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await mainNav().getByRole('button', { name: /^Server/ }).click()
  await expect(page.getByRole('region', { name: 'CPU' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('region', { name: 'Memory' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Disks' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Processes' })).toBeVisible()
  // one gateway per profile: default and scout each run one
  await expect(page.getByRole('cell', { name: /hermes_cli\.main gateway run/ })).toHaveCount(2)
  await page.getByRole('button', { name: /Hermes only/ }).click()
  await expect(page.getByRole('columnheader', { name: /CPU%/ })).toHaveAttribute('aria-sort', 'descending')
  await page.screenshot({ path: 'tests/e2e/shots/server.png' })
})

test('sidebar collapse and text size persist across launches', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.getByRole('button', { name: 'Larger text' }).click()
  await expect(page.getByRole('button', { name: 'Reset text size' })).toHaveText('110%')
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await expect(page.locator('aside.mc-side.is-rail')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Reset text size' })).toHaveText('110%')
})

test('reconnects after the server drops the connection', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible({ timeout: 20_000 })
  srv.dropConnections()
  await expect(page.getByText(/Reconnecting/).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible({ timeout: 30_000 })
})

test('the renderer is sandboxed', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  const probe = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    mc: typeof (window as unknown as { mc?: unknown }).mc
  }))
  expect(probe).toEqual({ require: 'undefined', process: 'undefined', mc: 'object' })
  const before = page.url()
  await page.evaluate(() => {
    window.location.href = 'https://example.com/'
  })
  await page.waitForTimeout(500)
  expect(page.url()).toBe(before)
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain('unsafe-eval')
})

test('forgetting the connection returns to first-time setup', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await page.getByRole('contentinfo').getByRole('status').filter({ hasText: 'tester@' }).click() // the connection chip opens Settings
  await page.getByRole('button', { name: /Forget this connection…/ }).click()
  await page.getByRole('button', { name: 'Forget this connection', exact: true }).click()
  await expect(page.getByText('first-time setup')).toBeVisible()
})
