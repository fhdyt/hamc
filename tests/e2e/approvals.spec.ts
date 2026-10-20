import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-acp-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-acp-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx, acp: true })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const conv = () => page.getByRole('region', { name: 'Conversation' })
const box = () => page.getByRole('textbox', { name: /^Message / })
const card = () => conv().getByRole('group', { name: /^Approval: terminal/ })

async function say(text: string): Promise<void> {
  // Enter is ignored while a turn still runs (the reply text can show before the turn ends), so wait for Send
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}

test('Hermes asks before a risky action; Deny tells the agent no', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Chat/ }).click()
  await page.locator('.dm-row').filter({ hasText: 'Scout' }).click()
  await say('danger: clean the cache')
  await expect(card()).toContainText('Hermes asks for your approval', { timeout: 20_000 })
  await expect(card()).toContainText('rm -rf ~/tmp/cache')
  await expect(card().getByRole('button', { name: 'Allow once' })).toBeVisible()
  await expect(card().getByRole('button', { name: 'Always allow' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible() // the turn is waiting for the answer
  await page.screenshot({ path: 'tests/e2e/shots/chat-approval.png' })
  await card().getByRole('button', { name: 'Deny' }).click()
  await expect(card()).toContainText('Denied: Deny')
  await expect(conv().getByText(/not allowed to run that/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
})

test('Allow once lets the agent continue, and the answered card stays in the conversation', async () => {
  await say('danger: do it again')
  const pending = conv().getByRole('group', { name: /^Approval: terminal/ }).filter({ hasText: 'Hermes asks for your approval' })
  await expect(pending).toBeVisible({ timeout: 20_000 })
  await pending.getByRole('button', { name: 'Allow once' }).click()
  await expect(conv().getByText(/Done, I ran it/)).toBeVisible({ timeout: 15_000 })
  await expect(conv().getByText('Allowed: Allow once')).toBeVisible()
})

test('the same agent remembers the conversation between messages', async () => {
  await say('plain question')
  await expect(conv().getByText(/what I found/).last()).toBeVisible({ timeout: 15_000 })
  await expect(conv().getByText(/\(turn 3\)/)).toBeVisible()
})

test('Stop while Hermes waits for an approval cancels the question', async () => {
  await say('danger: and once more')
  const pending = conv().getByRole('group', { name: /^Approval: terminal/ }).filter({ hasText: 'Hermes asks for your approval' })
  await expect(pending).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(conv().getByText('Not answered')).toBeVisible({ timeout: 15_000 })
  await expect(conv().getByText('Stopped')).toBeVisible()
})

test('the same room works in the Dashboard panel, and Settings → Chat can turn the mode off', async () => {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Dashboard/ }).click()
  await page.getByRole('button', { name: /^Scout, / }).click()
  const panel = page.locator('section[aria-label="Agents"]')
  await expect(panel.getByRole('textbox', { name: /^Message / })).toBeVisible()
  await page.getByRole('contentinfo').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('tab', { name: 'Chat' }).click()
  const sw = page.getByRole('switch', { name: 'Ask before risky actions' })
  await expect(sw).toBeChecked()
  await sw.click()
  await expect(sw).not.toBeChecked()
})
