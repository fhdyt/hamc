import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addProfile, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, resizeWindow, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-roster-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-roster-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

test('a profile created while the app is open appears within ten seconds', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await expect(page.getByText(/active agents? of 3/)).toBeVisible({ timeout: 20_000 })
  addProfile(fx.home, 'nova')
  await expect(page.getByText(/active agents? of 4/).or(page.getByText(/\d active agents? of 4/))).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /^nova, offline/ })).toBeVisible()
})

test('above six agents the roster groups pinned agents and offers search', async () => {
  for (const n of ['p1', 'p2', 'p3']) addProfile(fx.home, n)
  await expect(page.getByLabel('Search agents')).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText(/^Pinned · \d/)).toBeVisible()
  await expect(page.getByText(/^All agents · \d/)).toBeVisible()

  await page.getByLabel('Search agents').fill('nova')
  await expect(page.getByText('Results · 1')).toBeVisible()
  await page.getByLabel('Search agents').press('Escape')
  await expect(page.getByText(/^Pinned · \d/)).toBeVisible()

  await page.getByLabel('Search agents').fill('zzzz')
  await expect(page.getByText('No agent matches “zzzz”')).toBeVisible()
  await page.getByLabel('Search agents').press('Escape')
})

test('pinning survives a restart', async () => {
  await page.getByRole('button', { name: 'Pin nova' }).click({ force: true })
  await expect(page.getByRole('button', { name: 'Unpin nova' })).toBeVisible()
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 25_000 })
  await expect(page.getByRole('button', { name: 'Unpin nova' })).toBeVisible({ timeout: 20_000 })
})

test('selecting an agent shows its details and the rail keeps the selection', async () => {
  await page.getByRole('button', { name: /^Scout, / }).click()
  await expect(page.getByRole('group', { name: /Scout details/ }).or(page.getByLabel('Scout details'))).toBeVisible()
  await expect(page.getByText(/openrouter · anthropic\/claude-sonnet/)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Collapse agents panel' }).click()
  await expect(page.getByRole('button', { name: /^Scout, / })).toBeVisible()
  await expect(page.getByRole('button', { name: /more agents/ })).toBeVisible()
  await page.getByRole('button', { name: 'Expand agents panel' }).click()
  await expect(page.getByLabel('Search agents')).toBeVisible()
  await resizeWindow(app, 800, 700)
  await expect(page.locator('aside.mc-side .tl').first()).toBeHidden()
})
