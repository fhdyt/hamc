import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, resizeWindow, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-chat-ud-')
const filesDir = tmp('mc-e2e-chat-files-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-chat-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const conv = () => page.getByRole('region', { name: 'Conversation' })
const box = () => page.getByRole('textbox', { name: /^Message / })

async function say(text: string): Promise<void> {
  // Enter is ignored while a turn still runs (the reply text can show before the turn ends), so wait for Send
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 20_000 })
  await box().fill(text)
  await box().press('Enter')
}

test('chat with an agent: reply streams in as markdown, with a tool chip and run stats', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await mainNav().getByRole('button', { name: /^Chat/ }).click()
  await page.locator('.dm-row').filter({ hasText: 'Scout' }).click()
  await expect(page.getByText('Say hello to Scout')).toBeVisible()

  await say('hello scout')
  await expect(conv().getByText('hello scout')).toBeVisible()
  await expect(conv().getByRole('status', { name: /web_search/ }).or(conv().getByText(/what I found/))).toBeVisible({ timeout: 20_000 })
  await expect(conv().getByText('what I found')).toBeVisible({ timeout: 20_000 })
  await expect(conv().getByRole('listitem').filter({ hasText: 'item one' })).toBeVisible()
  await expect(conv().locator('pre.md-pre code')).toContainText("print('hello')")
  await expect(conv().getByText(/1\.5s/)).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: 'tests/e2e/shots/chat-reply.png' })
})

test('the saved conversation shows the thinking and the tool step, which fold open', async () => {
  const thinking = conv().getByRole('button', { name: /^Thinking/ })
  await expect(thinking).toBeVisible({ timeout: 25_000 })
  await thinking.click()
  await expect(conv().getByText(/search first/)).toBeVisible()
  const tool = conv().getByRole('button', { name: /^web_search/ })
  await tool.click()
  await expect(conv().getByText('3 results')).toBeVisible()
})

test('a code block can be copied', async () => {
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await conv().getByRole('button', { name: 'Copy code' }).first().click()
  await expect(conv().getByRole('button', { name: 'Copy code' }).first()).toHaveText('Copied')
})

test('Stop ends a long answer and Enter does not send while the agent is working', async () => {
  await say('slow please')
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(conv().getByText('Stopped')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
})

test('a failing run shows the error instead of an endless spinner', async () => {
  await say('please fail now')
  await expect(conv().getByRole('alert')).toContainText(/authentication|failed/i, { timeout: 20_000 })
})

test('Clear chat starts empty and History brings an earlier conversation back', async () => {
  await page.getByRole('button', { name: 'Clear chat' }).click()
  await expect(page.getByText('Say hello to Scout')).toBeVisible()
  await page.getByRole('button', { name: 'Chat history' }).click()
  const pop = page.getByRole('dialog', { name: 'Chat history' })
  await expect(pop.getByRole('button').first()).toBeVisible({ timeout: 15_000 })
  await pop.getByRole('button').filter({ hasText: /hello scout/ }).first().click()
  await expect(conv().getByText('hello scout')).toBeVisible({ timeout: 15_000 })
})

test('the Chat screen has an Activity panel with only this agent, and it follows the agent you pick', async () => {
  // the panel shows from 1100 px; CI screens can be smaller than the default window
  await resizeWindow(app, 1280, 800)
  const panel = page.getByRole('complementary', { name: 'Activity of Scout' })
  await expect(panel).toBeVisible()
  const rows = panel.getByRole('list', { name: 'Latest activity' }).getByRole('listitem')
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })
  const labels = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(labels.length).toBeGreaterThan(0)
  expect(labels.every((l) => l.startsWith('Scout,'))).toBe(true)
  await page.screenshot({ path: 'tests/e2e/shots/chat-activity.png' })
  await page.locator('.dm-row').filter({ hasText: 'default' }).click()
  const other = page.getByRole('complementary', { name: 'Activity of default' })
  await expect(other).toBeVisible()
  const otherLabels = await other.getByRole('listitem').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(otherLabels.every((l) => l.startsWith('default,'))).toBe(true)
  await page.locator('.dm-row').filter({ hasText: 'Scout' }).click()
})

test('files can be attached, are uploaded to the server when sent, and show in the message', async () => {
  const f = join(filesDir, 'report.txt')
  writeFileSync(f, 'quarterly numbers\n')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, f)
  await page.getByRole('button', { name: 'Attach files' }).click()
  const card = page.locator('.cp-file').filter({ hasText: 'report.txt' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('progressbar')).toBeVisible()
  await say('please read the attached report')
  await expect(conv().locator('.cv-file').filter({ hasText: 'report.txt' }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.cp-file')).toHaveCount(0, { timeout: 20_000 })
  const root = join(fx.root, 'home', 'hermes-uploads', 'scout')
  await expect.poll(() => existsSync(root) && readdirSync(root).length > 0).toBe(true)
})

test('the Dashboard agents panel holds the same chat, with details one click away', async () => {
  await mainNav().getByRole('button', { name: /^Dashboard/ }).click()
  await page.getByRole('button', { name: /^Scout, / }).click()
  const panel = page.locator('section[aria-label="Agents"]')
  await expect(panel.getByRole('textbox', { name: /^Message / })).toBeVisible()
  await panel.getByRole('button', { name: 'Show agent details' }).click()
  await expect(page.getByLabel('Scout details')).toBeVisible()
  await panel.getByRole('button', { name: 'Back to chat' }).click()
  await panel.getByRole('button', { name: 'Open full chat' }).click()
  await expect(page.getByRole('heading', { name: '@Scout' })).toBeVisible()
})

test('Settings → Uploads lists the sent file and deletes it after confirmation', async () => {
  await page.getByRole('contentinfo').getByRole('status').filter({ hasText: 'tester@' }).click()
  await page.getByRole('tab', { name: 'Uploads' }).click()
  const list = page.getByRole('list', { name: 'Uploaded files' })
  await expect(list.getByText('report.txt')).toBeVisible({ timeout: 15_000 })
  await list.getByRole('button', { name: 'Delete report.txt' }).click()
  await list.getByRole('button', { name: 'Confirm delete report.txt' }).click()
  await expect(page.getByText('The upload folder is empty').or(page.getByText('Nothing uploaded yet'))).toBeVisible({ timeout: 15_000 })
  const root = join(fx.root, 'home', 'hermes-uploads', 'scout')
  await expect.poll(() => !existsSync(root) || readdirSync(root).every((d) => readdirSync(join(root, d)).length === 0)).toBe(true)
})
