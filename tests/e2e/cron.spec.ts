import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-cron-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-cron-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const panel = () => page.locator('section.card[aria-label="Cron jobs"]')
const dialog = () => page.getByRole('dialog', { name: 'Cron jobs' })
const rows = () => page.locator('table.cron-table tbody tr[aria-selected]')

test('the Cron panel lists the jobs of every profile with a visible error count', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await expect(panel()).toContainText('3 jobs', { timeout: 20_000 })
  await expect(panel()).toContainText('1 err')
  await expect(panel().getByRole('listitem')).toHaveCount(3)
  await expect(panel().getByRole('listitem', { name: /second-brain-daily-sync.*ERROR/ })).toBeVisible()
  await expect(panel().getByRole('listitem', { name: /never-ran.*NEVER RUN/ })).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/cron-panel.png' })
})

test('clicking a job opens the modal on that job with its failure streak and output', async () => {
  await panel().getByRole('listitem', { name: /second-brain-daily-sync/ }).click()
  await expect(dialog()).toBeVisible()
  const detail = dialog().getByLabel('Job detail')
  await expect(detail).toContainText('second-brain-daily-sync')
  await expect(detail).toContainText('Failed 10 runs in a row')
  await expect(detail).toContainText('ERROR')
  await expect(detail.getByLabel('Last output')).toContainText('latest run', { timeout: 15_000 })
  await expect(dialog().getByRole('img', { name: /scheduled runs in the next 24 hours/ })).toBeVisible()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'tests/e2e/shots/cron-modal.png' })
})

test('the table lists every job and the filters narrow it', async () => {
  await expect(rows()).toHaveCount(3)
  await dialog().getByLabel('Status', { exact: true }).selectOption('error')
  await expect(rows()).toHaveCount(1)
  await dialog().getByLabel('Status', { exact: true }).selectOption('never')
  await expect(rows()).toHaveCount(1)
  await expect(rows().first()).toContainText('never-ran')
  await dialog().getByLabel('Status', { exact: true }).selectOption('all')
  await dialog().getByLabel('Agent', { exact: true }).selectOption('scout')
  await expect(rows()).toHaveCount(2)
  await dialog().getByLabel('Agent', { exact: true }).selectOption('all')
  await dialog().getByLabel('Search jobs').fill('pantau')
  await expect(rows()).toHaveCount(1)
  await dialog().getByLabel('Search jobs').fill('zzzz')
  await expect(rows()).toHaveCount(0)
  await expect(dialog()).toContainText('No jobs match the filters.')
  await dialog().getByLabel('Search jobs').fill('')
  await expect(rows()).toHaveCount(3)
})

test('details cover a job without output, a legacy output file and every status as text', async () => {
  await dialog().getByRole('button', { name: 'never-ran' }).click()
  const detail = dialog().getByLabel('Job detail')
  await expect(detail).toContainText('NEVER RUN')
  await expect(detail).toContainText('has not produced any output yet')
  await dialog().getByRole('button', { name: 'Pantau pembaruan' }).click()
  await expect(detail.getByLabel('Last output')).toContainText('legacy loose file', { timeout: 15_000 })
  await expect(detail).toContainText('telegram:744164478')
  await expect(detail).toContainText('UTC+07:00')
})

test('the modal is read-only', async () => {
  await expect(dialog().getByRole('button', { name: /pause|resume|run now|edit schedule|acknowledge/i })).toHaveCount(0)
})

test('Escape closes the modal', async () => {
  await page.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)
})

test('the panel can be collapsed and stays collapsed after a restart', async () => {
  await panel().getByRole('button', { name: 'Hide cron' }).click()
  await expect(panel().getByRole('listitem')).toHaveCount(0)
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 25_000 })
  await expect(panel().getByRole('button', { name: 'Show cron' })).toBeVisible()
  await expect(panel().getByRole('listitem')).toHaveCount(0)
  await panel().getByRole('button', { name: 'Show cron' }).click()
  await expect(panel().getByRole('listitem')).toHaveCount(3, { timeout: 15_000 })
})
