import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-badge-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-badge-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const chatItem = () => mainNav().getByRole('button', { name: /^Chat/ })
const box = () => page.getByRole('textbox', { name: /^Message / })

async function say(text: string): Promise<void> {
  await box().fill(text)
  await box().press('Enter')
}

test('a reply that ends while the user is on another screen shows a badge on Chat, and opening the chat clears it', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await chatItem().click()
  await page.locator('.dm-row').filter({ hasText: 'Scout' }).click()
  await say('slow please')
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 15_000 })
  await mainNav().getByRole('button', { name: /^Usage/ }).click()
  await expect(chatItem()).toHaveAttribute('aria-label', 'Chat, 1 unread reply', { timeout: 40_000 })
  await page.screenshot({ path: 'tests/e2e/shots/chat-badge.png' })
  await chatItem().click()
  await expect(chatItem()).not.toHaveAttribute('aria-label', /unread/)
})

test('a turn the user stops does not count', async () => {
  await say('slow again')
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 15_000 })
  await mainNav().getByRole('button', { name: /^Usage/ }).click()
  await chatItem().click()
  await page.getByRole('button', { name: 'Stop' }).click()
  await mainNav().getByRole('button', { name: /^Usage/ }).click()
  await page.waitForTimeout(4000)
  await expect(chatItem()).not.toHaveAttribute('aria-label', /unread/)
})
