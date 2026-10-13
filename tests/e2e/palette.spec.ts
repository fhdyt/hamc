import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-palette-ud-')
let app: ElectronApplication
let page: Page
let treeBefore: ReturnType<typeof snapshotTree>

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-palette-fx-'), 'fx'))
  treeBefore = snapshotTree(fx.root)
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const palette = () => page.getByRole('dialog', { name: 'Command palette' })
const input = () => palette().getByRole('combobox')
const option = (name: string | RegExp) => palette().getByRole('option', { name })

async function openWithKeys(): Promise<void> {
  await page.keyboard.press('Control+k')
  await expect(palette()).toBeVisible()
}

test('Ctrl+K opens the palette with the input focused and Escape closes it', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await openWithKeys()
  await expect(input()).toBeFocused()
  await expect(option('Dashboard')).toBeVisible()
  await expect(option(/Open Settings/)).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/palette.png' })
  await page.keyboard.press('Escape')
  await expect(palette()).toBeHidden()
})

test('the Search button opens it and Ctrl+K toggles it', async () => {
  await mainNav().locator('xpath=..').getByRole('button', { name: 'Search' }).click()
  await expect(palette()).toBeVisible()
  await page.keyboard.press('Control+k')
  await expect(palette()).toBeHidden()
})

test('typing narrows the list and the arrow keys move the highlighted option', async () => {
  await openWithKeys()
  await input().fill('scout')
  await expect(option('Chat with Scout')).toBeVisible()
  await expect(option('Scout · Model')).toBeVisible()
  const first = await input().getAttribute('aria-activedescendant')
  await page.keyboard.press('ArrowDown')
  const second = await input().getAttribute('aria-activedescendant')
  expect(second).not.toBe(first)
  await expect(palette().locator(`#${second}`)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
})

test('an empty result says what to try', async () => {
  await openWithKeys()
  await input().fill('zzzzqq')
  await expect(palette().getByText(/No results for “zzzzqq”/)).toBeVisible()
  await expect(palette().getByText(/Try a screen name, an agent, a session title or a note/)).toBeVisible()
  await page.keyboard.press('Escape')
})

test('Enter on an agent opens its chat', async () => {
  await openWithKeys()
  await input().fill('chat with scout')
  await page.keyboard.press('Enter')
  await expect(palette()).toBeHidden()
  await expect(mainNav().getByRole('button', { name: /^Chat/ })).toHaveAttribute('aria-current', 'page')
})

test('a session title jumps to Sessions with that session open', async () => {
  await openWithKeys()
  await input().fill('morning briefing')
  await expect(option(/Morning briefing/)).toBeVisible({ timeout: 15_000 })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Session detail' })).toContainText('Morning briefing', { timeout: 15_000 })
})

test('an agent settings item opens Settings on that tab', async () => {
  await openWithKeys()
  await input().fill('scout memory')
  await option('Scout · Memory').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Agents' })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('tab', { name: /^Memory/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the Cron action opens the Dashboard with the Cron dialog', async () => {
  await openWithKeys()
  await input().fill('cron jobs')
  await option(/Open Cron jobs/).click()
  await expect(page.getByRole('dialog', { name: 'Cron jobs' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Cron jobs' })).toBeHidden()
})

test("Show today's cost lands on Usage with today pressed", async () => {
  await openWithKeys()
  await input().fill('today')
  await option(/Show today's cost/).click()
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
  const chart = page.getByRole('group', { name: /Bar chart of daily cost in US dollars/ })
  await expect(chart).toBeVisible({ timeout: 20_000 })
  await expect(chart.getByRole('button', { pressed: true })).toHaveCount(1)
})

test('opening the palette changes nothing on the server', async () => {
  const verbs = new Set(srv.execLog.map((a) => a[0]))
  for (const bad of ['rm', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'sudo', 'chmod', 'curl', 'wget', 'tar', 'sed', 'cat']) expect(verbs.has(bad)).toBe(false)
  expect(snapshotTree(fx.root)).toEqual(treeBefore)
})
