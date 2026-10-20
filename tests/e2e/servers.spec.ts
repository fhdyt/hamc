import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

// F-CONN-14..17: saved servers, the status bar server menu and Settings → Servers
test.describe.configure({ mode: 'serial' })

let a: FakeSsh
let b: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-servers-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-servers-fx-'), 'fx'))
  a = await startFakeSsh({ fixture: fx })
  b = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await a.close()
  await b.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const serverButton = () => page.getByRole('contentinfo').getByRole('button', { name: /^Server: / })
const menu = () => page.getByRole('menu', { name: 'Servers' })

test('adds a second server from the status bar menu', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, a)
  await expect(serverButton()).toHaveText(/tester@127\.0\.0\.1/)

  await serverButton().click()
  await expect(menu()).toBeVisible()
  await expect(menu().getByRole('menuitemradio', { name: /tester@127\.0\.0\.1/ })).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: 'tests/e2e/shots/servers-menu.png' })
  await menu().getByRole('menuitem', { name: 'Add server…' }).click()

  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('heading', { name: 'Add server' })).toBeVisible()
  await settings.getByLabel(/^name/).fill('lab')
  await settings.getByLabel('host / public ip').fill('127.0.0.1')
  await settings.getByLabel('ssh port').fill(String(b.port))
  await settings.getByLabel(/^username/).fill('tester')
  await settings.getByLabel(/^password/).fill('test-pass-123')
  await expect(settings.getByText('Saving connects to this server')).toBeVisible()
  await settings.getByRole('button', { name: /TEST & CONNECT/ }).click()
  await expect(page.getByRole('alertdialog', { name: 'Host key verification' })).toBeVisible()
  await page.getByRole('button', { name: /TRUST & CONTINUE/ }).click()
  await expect(settings).toHaveCount(0, { timeout: 25_000 })
  await expect(serverButton()).toHaveText(/lab/)
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible({ timeout: 25_000 })
})

test('switches back from the menu and from the palette', async () => {
  await serverButton().click()
  await expect(menu().getByRole('menuitemradio', { name: /^lab / })).toHaveAttribute('aria-checked', 'true')
  // keyboard: the first item has the focus, Escape closes and gives it back
  await page.keyboard.press('Escape')
  await expect(menu()).toHaveCount(0)
  await expect(serverButton()).toBeFocused()

  await serverButton().click()
  await menu().getByRole('menuitemradio', { name: /^tester@127\.0\.0\.1 / }).click()
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await expect(serverButton()).toHaveText(/tester@127\.0\.0\.1/)
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible({ timeout: 25_000 })

  await page.keyboard.press('Control+K')
  await page.getByRole('combobox').fill('switch to lab')
  await page.getByRole('option', { name: /Switch to lab/ }).click()
  await expect(serverButton()).toHaveText(/lab/, { timeout: 25_000 })
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible({ timeout: 25_000 })
})

test('lists servers in Settings, renames one and forgets the other', async () => {
  await serverButton().click()
  await menu().getByRole('menuitem', { name: 'Manage servers…' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  const list = settings.getByRole('list', { name: 'Saved servers' })
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByRole('listitem').filter({ hasText: 'lab' }).getByText('Active')).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/servers-settings.png' })

  await settings.getByRole('button', { name: 'Edit lab' }).click()
  await settings.getByLabel(/^name/).fill('lab-2')
  await settings.getByRole('button', { name: /TEST & SAVE/ }).click()
  await expect(settings).toHaveCount(0, { timeout: 25_000 })
  await expect(serverButton()).toHaveText(/lab-2/)

  await serverButton().click()
  await menu().getByRole('menuitem', { name: 'Manage servers…' }).click()
  await settings.getByRole('button', { name: /^Forget tester@/ }).click()
  await settings.getByRole('button', { name: 'Forget this server', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(serverButton()).toHaveText(/lab-2/)
  await page.keyboard.press('Escape')
})

test('auto-connects to the last server on the next launch', async () => {
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByText(/auto-connecting to/)).toContainText('lab-2')
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await expect(serverButton()).toHaveText(/lab-2/)
})
