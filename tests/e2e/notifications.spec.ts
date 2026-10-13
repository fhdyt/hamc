import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-nt-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx, tuiGateway: true })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const settings = () => page.getByRole('dialog', { name: 'Settings' })
const bar = () => page.getByRole('contentinfo', { name: 'Status bar' })

test('Settings → Notifications holds the switches, quiet hours and a test button', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-nt-ud-')))
  await connectFresh(page, srv)
  await bar().getByRole('button', { name: 'Settings' }).click()
  await settings().getByRole('tab', { name: 'Notifications' }).click()
  const desktop = settings().getByRole('switch', { name: 'Show desktop notifications over other apps' })
  await expect(desktop).toHaveAttribute('aria-checked', 'true')
  await expect(settings().getByRole('group', { name: 'What to notify' }).getByRole('switch')).toHaveCount(4)
  await expect(settings().getByLabel('Quiet from')).toBeDisabled()
  await settings().getByRole('switch', { name: 'Do not disturb' }).click()
  await expect(settings().getByLabel('Quiet from')).toBeEnabled()
  await settings().getByRole('button', { name: 'Send a test notification' }).click()
  await expect(settings().locator('.banner')).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/settings-notifications.png' })
})

test('Settings → Workspace shows the vault and where Hermes was found', async () => {
  await settings().getByRole('tab', { name: 'Workspace' }).click()
  await expect(settings().getByLabel('Vault path')).toHaveText('No vault chosen')
  await expect(settings().getByRole('region', { name: 'Hermes on the server' })).toContainText('/home/hermes/.hermes')
  await settings().getByRole('tab', { name: 'General' }).click()
  await expect(settings().getByRole('switch', { name: 'Keep running in the tray' })).toHaveAttribute('aria-checked', 'false')
  await expect(settings().getByRole('switch', { name: 'Start minimized' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings()).toBeHidden()
})

test('a reply that finishes while the agent is not on screen lands in the bell and opens the chat', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Chat/ }).click()
  await page.locator('.dm-row').filter({ hasText: 'Scout' }).click()
  const box = page.getByRole('textbox', { name: /^Message / })
  await box.fill('slow job')
  await box.press('Enter')
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Logs/ }).click()
  await expect(bar().getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible({ timeout: 40_000 })
  await bar().getByRole('button', { name: /^Notifications/ }).click()
  const panel = page.getByRole('dialog', { name: 'Notifications' })
  await expect(panel.getByRole('list', { name: 'Notification history' })).toContainText('Scout replied')
  await expect(panel).toContainText('what I found')
  await expect(bar().getByRole('button', { name: 'Notifications' })).toBeVisible() // opening marks them read
  await panel.getByRole('button', { name: /Scout replied/ }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('textbox', { name: 'Message Scout' })).toBeVisible()
})
