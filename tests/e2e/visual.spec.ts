import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { advanceFixture, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, resizeWindow, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let fxDir: string
let ticker: NodeJS.Timeout
const userData = tmp('mc-e2e-visual-ud-')
let app: ElectronApplication
let page: Page
const shot = (name: string) => page.screenshot({ path: `tests/e2e/shots/${name}.png` })

test.beforeAll(async () => {
  fxDir = join(tmp('mc-e2e-visual-fx-'), 'fx')
  fx = buildFixture(fxDir)
  srv = await startFakeSsh({ fixture: fx })
  let step = 1
  ticker = setInterval(() => advanceFixture(fxDir, step++), 1000)
})
test.afterAll(async () => {
  clearInterval(ticker)
  await app?.close().catch(() => {})
  await srv.close()
})

test('captures Connect, host key and the connected screens at 1440x900', async () => {
  ;({ app, page } = await launchApp(userData))
  await resizeWindow(app, 1440, 900)
  await expect(page.getByText('first-time setup')).toBeVisible()
  await shot('connect-empty')
  await page.getByLabel('host / public ip').fill('127.0.0.1')
  await page.getByLabel('ssh port').fill(String(srv.port))
  await page.getByLabel(/^username/).fill('tester')
  await page.getByLabel(/^password/).fill('test-pass-123')
  await page.getByRole('button', { name: /TEST & CONNECT/ }).click()
  await expect(page.getByRole('alertdialog', { name: 'Host key verification' })).toBeVisible()
  await shot('connect-hostkey')
  await page.getByRole('button', { name: /TRUST & CONTINUE/ }).click()
  await expect(page.getByText(/checks passed/)).toBeVisible({ timeout: 20_000 })
  await shot('connect-preflight')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/active agents? of 3/)).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(6000)
  await shot('dashboard-1440')
  await page.getByRole('button', { name: /^Scout, / }).click()
  await shot('dashboard-selected')
})

test('captures Settings, the coming-later screen and narrow layouts', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.waitForTimeout(450)
  await shot('settings-general')
  await page.getByRole('tab', { name: 'Connection' }).click()
  await expect(page.getByRole('tab', { name: 'Connection' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'false')
  await page.waitForTimeout(450)
  await shot('settings-connection')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Kanban/ }).click()
  await shot('coming-later')

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Dashboard/ }).click()
  await resizeWindow(app, 900, 760)
  await page.waitForTimeout(400)
  await shot('dashboard-900')
  await resizeWindow(app, 1100, 800)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Server/ }).click()
  await page.waitForTimeout(800)
  await shot('server-1100')
})

test('keyboard shortcuts move between screens and zoom', async () => {
  await resizeWindow(app, 1440, 900)
  await page.keyboard.press('Control+0')
  await expect(page.getByRole('region', { name: 'CPU' })).toBeVisible()
  await page.keyboard.press('Control+1')
  await expect(page.getByRole('region', { name: 'Agents' })).toBeVisible()
  await page.keyboard.press('Control+=')
  await expect(page.getByRole('button', { name: 'Reset text size' })).toHaveText('110%')
  await page.keyboard.press('Control+-')
  await expect(page.getByRole('button', { name: 'Reset text size' })).toHaveText('100%')
})
