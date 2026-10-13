import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-ses-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-ses-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const list = () => page.getByRole('listbox', { name: 'Sessions' })
const options = () => list().getByRole('option')
const filters = () => page.getByRole('search', { name: 'Session filters' })
const search = () => page.getByLabel('Search sessions and messages')

test('the Sessions screen lists the sessions of every agent', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await mainNav().getByRole('button', { name: /^Sessions/ }).click()
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  await expect(options()).toHaveCount(4, { timeout: 20_000 })
  await expect(options().filter({ hasText: 'Digest run' })).toHaveCount(1)
  await expect(options().filter({ hasText: 'Morning briefing' })).toContainText('telegram')
  await expect(options().filter({ hasText: 'Digest run' })).toContainText('$0.50')
  await expect(options().filter({ hasText: 'Morning briefing' })).toContainText('$0.02 est.')
  await page.screenshot({ path: 'tests/e2e/shots/sessions-list.png' })
})

test('search looks inside messages and highlights the match', async () => {
  await search().fill('digest')
  await expect(options()).toHaveCount(1)
  await expect(options().first().locator('mark')).toHaveText(/digest/i)
  await search().fill('zzzz-nothing')
  await expect(page.getByText(/No sessions match/)).toBeVisible()
  await page.getByRole('button', { name: 'Clear search and filters' }).click()
  await expect(search()).toHaveValue('')
  await expect(options().first()).toBeVisible()
})

test('the agent and range filters narrow the list and are remembered', async () => {
  await filters().getByRole('button', { name: 'Scout' }).click()
  await expect(options()).toHaveCount(2)
  await expect(filters().getByRole('button', { name: 'Scout' })).toHaveAttribute('aria-pressed', 'true')
  await filters().getByLabel('Time range').selectOption('today')
  await expect(options().filter({ hasText: 'Digest run' })).toHaveCount(1)
  await filters().getByRole('button', { name: 'All', exact: true }).click()
  await filters().getByLabel('Time range').selectOption('7d')
  await expect(options()).toHaveCount(4)
  await filters().getByLabel('Source').selectOption('cron')
  await expect(options()).toHaveCount(1)
  await filters().getByLabel('Source').selectOption('all')
  await expect(options()).toHaveCount(4)
})

test('arrow keys move the selection through the list', async () => {
  await list().focus()
  await page.keyboard.press('ArrowDown')
  await expect(options().first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(options().nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(options().first()).toHaveAttribute('aria-selected', 'false')
})
