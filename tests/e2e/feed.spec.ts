import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addMessage, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-feed-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-feed-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const activity = () => page.locator('section.card[aria-label="Activity"]')
const rows = () => page.locator('.fr')
const filters = () => page.getByRole('search', { name: 'Feed filters' })
const kindChip = (name: string) => filters().getByRole('button', { name, exact: true })

test('the Dashboard activity panel shows the latest items and opens the feed in a dialog', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await expect(activity().getByRole('listitem', { name: /Scout, REPLY: digest done/ })).toBeVisible({ timeout: 20_000 })
  await expect(activity().getByRole('listitem', { name: /USER: hello agent/ })).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/feed-activity.png' })

  await activity().getByRole('button', { name: 'Open the live feed' }).click()
  const dialog = page.getByRole('dialog', { name: 'Live feed' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.fr').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the Live feed lists every kind newest first with agent and source', async () => {
  await mainNav().getByRole('button', { name: /^Live feed/ }).click()
  await expect(page.getByRole('heading', { name: 'Live feed' })).toBeVisible()
  await expect(rows().first()).toBeVisible({ timeout: 15_000 })
  const kinds = await rows().evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['kind']))
  expect(new Set(kinds)).toEqual(new Set(['user', 'reply', 'thinking', 'tool', 'result']))
  // newest first: the scout cron run is more recent than the default telegram chat
  const profiles = await rows().evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['profile']))
  expect(profiles[0]).toBe('scout')
  await expect(rows().filter({ hasText: 'hello agent' })).toContainText('telegram')
  await expect(rows().filter({ hasText: 'digest done' })).toContainText('cron')
  await expect(page.getByText(/\d+ items? loaded · newest first/)).toBeVisible()
})

test('filters hide agents and kinds, search narrows, and reset brings everything back', async () => {
  const total = await rows().count()
  await kindChip('Tool result').click()
  await expect(kindChip('Tool result')).toHaveAttribute('aria-pressed', 'false')
  await expect(rows().filter({ hasText: '3 results' })).toHaveCount(0)
  await kindChip('Tool result').click()
  await expect(rows()).toHaveCount(total)

  await filters().getByRole('button', { name: 'Scout' }).click()
  await expect(page.locator('.fr[data-profile="scout"]')).toHaveCount(0)
  await expect(rows().first()).toBeVisible()
  await filters().getByRole('button', { name: 'Reset filters' }).click()
  await expect(rows()).toHaveCount(total)

  await page.getByLabel('Search the feed').fill('digest')
  await expect(rows()).toHaveCount(2)
  await page.getByLabel('Search the feed').fill('zzzz-nothing')
  await expect(page.getByText('Nothing matches')).toBeVisible()
  await page.getByRole('button', { name: 'Reset filters' }).last().click()
  await expect(rows()).toHaveCount(total)
})

test('a message written to state.db appears within a few seconds', async () => {
  addMessage(join(fx.home, 'state.db'), 's-default-1', 'user', 'a brand new message from the test', Date.now() / 1000)
  await expect(rows().filter({ hasText: 'a brand new message from the test' })).toBeVisible({ timeout: 6000 })
  expect(await rows().first().getAttribute('data-kind')).toBe('user')
  await page.screenshot({ path: 'tests/e2e/shots/feed.png' })
})

test('long text is clamped and expands; a cut-off text loads in full from the server', async () => {
  const long = Array.from({ length: 60 }, (_, i) => `line ${i} of a long message`).join(' ')
  addMessage(join(fx.home, 'state.db'), 's-default-1', 'user', long, Date.now() / 1000 + 1)
  const row = rows().filter({ hasText: 'line 0 of a long message' })
  await expect(row).toBeVisible({ timeout: 6000 })
  await expect(row.locator('.fr-text')).toHaveClass(/clamp4/)
  await row.getByRole('button', { name: 'Show more' }).click()
  await expect(row.locator('.fr-text')).not.toHaveClass(/clamp4/)
  await row.getByRole('button', { name: 'Show less' }).click()
  await expect(row.locator('.fr-text')).toHaveClass(/clamp4/)

  const huge = 'x'.repeat(5000) + ' THE-END'
  addMessage(join(fx.home, 'state.db'), 's-default-1', 'user', huge, Date.now() / 1000 + 2)
  const cut = rows().filter({ hasText: 'xxxxxxxxxx' }).first()
  await expect(cut.getByRole('button', { name: 'Show full' })).toBeVisible({ timeout: 6000 })
  await expect(cut).not.toContainText('THE-END')
  await cut.getByRole('button', { name: 'Show full' }).click()
  await expect(cut).toContainText('THE-END', { timeout: 10_000 })
})

test('the whole session opens from an item, with its sub-sessions', async () => {
  await rows().filter({ hasText: 'digest done' }).hover()
  await rows().filter({ hasText: 'digest done' }).getByRole('button', { name: /Open the cron session/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Session · Scout' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('run the digest')
  await expect(dialog).toContainText('digest done')
  await expect(dialog).toContainText('cron')
  await page.screenshot({ path: 'tests/e2e/shots/feed-session.png' })
  await dialog.getByRole('button', { name: /subagent · s-scout-child/ }).click()
  await expect(dialog).toContainText('child work')
  await expect(dialog).toContainText('s-scout-1') // the parent is linked back
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('an agent card shows today’s numbers and opens the feed filtered to that agent', async () => {
  await mainNav().getByRole('button', { name: /^Dashboard/ }).click()
  await page.getByRole('button', { name: /^Scout, / }).click()
  const detail = page.getByLabel('Scout details')
  await expect(detail).toContainText('today')
  await expect(detail.getByLabel("Today's activity")).toContainText(/\d+ sessions?/)
  await detail.getByRole('button', { name: 'Open feed' }).click()
  await expect(page.getByRole('heading', { name: 'Live feed' })).toBeVisible()
  await expect(rows().first()).toBeVisible()
  expect(new Set(await rows().evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['profile'])))).toEqual(new Set(['scout']))
})
