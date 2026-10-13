import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addToolData, addUsageData, buildFixture, snapshotTree, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, resizeWindow, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-usage-ud-')
let app: ElectronApplication
let page: Page
let treeBefore: ReturnType<typeof snapshotTree>

/** Local midnight 20 days ago plus 100 s, in epoch seconds: far from the sessions the standard fixture has. */
const base = (() => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 20).getTime() / 1000 + 100
})()

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-usage-fx-'), 'fx'))
  addUsageData(fx.root, base)
  addToolData(fx.root, base)
  treeBefore = snapshotTree(fx.root)
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const chart = () => page.getByRole('group', { name: /Bar chart of daily cost in US dollars/ })
const byAgent = () => page.getByRole('region', { name: 'by agent' })
const byModel = () => page.getByRole('region', { name: 'by model' })
const filters = () => page.getByRole('search', { name: 'Usage filters' })

test('the Usage screen shows the cost chart and the tables for the chosen range', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await mainNav().getByRole('button', { name: /^Usage/ }).click()
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Cost' })).toHaveAttribute('aria-selected', 'true')
  await expect(chart()).toBeVisible({ timeout: 20_000 })
  await filters().getByLabel('Time range').selectOption('30d')
  await expect(chart()).toHaveAttribute('aria-label', /for 30 days, total \$/)
  await expect(byAgent()).toContainText('default')
  await expect(byAgent()).toContainText('Scout')
  await expect(byModel()).toContainText('m-a')
  await expect(byModel()).toContainText('prov-a')
  await expect(page.getByText(/avg · .* today/)).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/usage-cost.png' })
})

test('clicking a day pins it and the tables follow, Escape lets go', async () => {
  const day = chart().getByRole('button', { name: /\$3\.00/ })
  await expect(day).toHaveCount(1)
  await day.click()
  await expect(day).toHaveAttribute('aria-pressed', 'true')
  await expect(byAgent().getByRole('heading')).not.toContainText('Last 30 days')
  await expect(byAgent()).toContainText('$3.00 est.')
  await expect(byAgent()).toContainText('$0.00')
  await page.keyboard.press('Escape')
  await expect(day).toHaveAttribute('aria-pressed', 'false')
  await expect(byAgent().getByRole('heading')).toContainText('Last 30 days')
})

test('the agent filter narrows the tables and the range select changes the window', async () => {
  await filters().getByRole('button', { name: 'Scout' }).click()
  await expect(byAgent()).not.toContainText('default')
  await expect(byAgent()).toContainText('Scout')
  await filters().getByRole('button', { name: 'All', exact: true }).click()
  await filters().getByLabel('Time range').selectOption('14d')
  await expect(chart()).toHaveAttribute('aria-label', /for 14 days/)
  await filters().getByLabel('Time range').selectOption('30d')
})

// The Tools tab, the alert and the closing checks are added in later tasks.
void resizeWindow
void treeBefore
void expect
