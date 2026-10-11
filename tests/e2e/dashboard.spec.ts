import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-dash-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-dash-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const sep = (name: string) => page.getByRole('separator', { name })
const value = async (name: string): Promise<number> => Number(await sep(name).getAttribute('aria-valuenow'))
const agents = () => page.locator('section[aria-label="Agents"]')

async function drag(name: string, dx: number, dy: number): Promise<void> {
  const box = (await sep(name).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

test('the Dashboard has the mockup layout: count line, cron, activity, server, graph and agents', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await expect(page.getByText(/\d+\/3 agents online/)).toBeVisible({ timeout: 20_000 })
  for (const name of ['Cron jobs', 'Activity', 'Server', 'Second brain', 'Agents']) await expect(page.locator(`section[aria-label="${name}"]`)).toBeVisible()
  await expect(page.locator('section[aria-label="Server"]')).toContainText('vCPU')
  await expect(page.locator('section[aria-label="Server"]')).toContainText('mem')
  await page.screenshot({ path: 'tests/e2e/shots/dashboard-parity.png' })
})

test('the activity panel shows items, not an endless spinner, and has an alerts tab', async () => {
  const panel = page.locator('section[aria-label="Activity"]')
  await expect(panel.getByRole('list', { name: 'Latest activity' })).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByRole('status', { name: 'Loading' })).toHaveCount(0)
  await panel.getByRole('tab', { name: /^alerts/ }).click()
  await expect(panel.getByRole('list', { name: 'Alerts' })).toContainText('second-brain-daily-sync')
  await panel.getByRole('tab', { name: 'activity' }).click()
  await expect(panel.getByRole('list', { name: 'Latest activity' })).toBeVisible()
})

test('the agents and chat panel can be widened by dragging its divider, and with the keyboard', async () => {
  const w0 = (await agents().boundingBox())!.width
  expect(await value('Resize chat panel')).toBe(320)
  await drag('Resize chat panel', 100, 0)
  expect(await value('Resize chat panel')).toBe(420)
  expect((await agents().boundingBox())!.width).toBeGreaterThan(w0 + 90)
  await sep('Resize chat panel').focus()
  await page.keyboard.press('ArrowRight')
  expect(await value('Resize chat panel')).toBe(444)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  expect(await value('Resize chat panel')).toBe(396)
  await drag('Resize chat panel', -1000, 0) // cannot go below the minimum
  expect(await value('Resize chat panel')).toBe(260)
  await drag('Resize chat panel', 2000, 0) // nor above the maximum
  expect(await value('Resize chat panel')).toBe(640)
  await drag('Resize chat panel', -320, 0)
  expect(await value('Resize chat panel')).toBe(320)
  await drag('Resize chat panel', 60, 0)
})

test('cron and activity share the column through a horizontal divider that goes away when one is hidden', async () => {
  const before = await value('Resize cron and activity')
  await drag('Resize cron and activity', 0, 40)
  expect(await value('Resize cron and activity')).toBe(before + 40)
  await page.locator('section[aria-label="Cron jobs"]').getByRole('button', { name: 'Hide cron' }).click()
  await expect(sep('Resize cron and activity')).toHaveCount(0)
  await page.locator('section[aria-label="Cron jobs"]').getByRole('button', { name: 'Show cron' }).click()
  await expect(sep('Resize cron and activity')).toBeVisible()
})

test('selecting an agent adds the divider between the agent list and its details', async () => {
  await expect(sep('Resize agent list and chat')).toHaveCount(0)
  await page.getByRole('button', { name: /^Scout, / }).click()
  await expect(sep('Resize agent list and chat')).toBeVisible()
  const h = await value('Resize agent list and chat')
  await drag('Resize agent list and chat', 0, 30)
  expect(await value('Resize agent list and chat')).toBe(h + 30)
  await page.getByRole('button', { name: /^Scout, / }).click()
})

test('the sizes are kept after a restart', async () => {
  await page.waitForTimeout(500)
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByText(/\d+\/3 agents online/)).toBeVisible({ timeout: 30_000 })
  expect(await value('Resize chat panel')).toBe(380)
  expect(await value('Resize cron and activity')).toBe(240)
})
