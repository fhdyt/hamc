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

const detail = () => page.getByRole('region', { name: 'Session detail' })
const open = (title: string) => options().filter({ hasText: title }).click()

test('a transcript shows thinking, replies and a chain between a session and its sub-session', async () => {
  await open('Digest run')
  await expect(detail().getByRole('heading', { name: 'Digest run', level: 2 })).toBeVisible()
  await expect(detail().getByText('digest done')).toBeVisible()
  await expect(detail().getByText('Thinking')).toBeVisible()
  await expect(detail().getByText('continued in')).toBeVisible()
  await detail().locator('.ses-chain', { hasText: 'continued in' }).getByRole('button').click()
  await expect(detail().getByText('continues')).toBeVisible()
  await expect(detail().getByText('child work')).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/sessions-transcript.png' })
})

test('a tool call opens to its input and output', async () => {
  await open('Morning briefing')
  const chip = detail().getByRole('button', { name: /web_search/ })
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(detail().getByText('3 results')).toBeVisible()
  await expect(detail().getByText('Input')).toBeVisible()
})

test('pin and rename show the exact command, wait for a yes and run it through the CLI', async () => {
  await detail().getByRole('button', { name: 'Pin', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: 'Pin session' })
  await expect(dlg.getByText('$ hermes sessions pin s-default-1')).toBeVisible()
  expect(srv.hermes.sessionCalls).toEqual([])
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await expect(dlg).toBeHidden()
  expect(srv.hermes.sessionCalls).toEqual([])

  await detail().getByRole('button', { name: 'Pin', exact: true }).click()
  await page.getByRole('dialog', { name: 'Pin session' }).getByRole('button', { name: 'Pin session' }).click()
  await expect(detail().getByText('Session pinned')).toBeVisible()
  expect(srv.hermes.sessionCalls).toEqual([['sessions', 'pin', 's-default-1']])

  await detail().getByRole('button', { name: 'Rename' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename session' })
  const ok = rename.getByRole('button', { name: 'Rename session' })
  await rename.getByLabel('New title').fill('   ')
  await expect(ok).toBeDisabled()
  await rename.getByLabel('New title').fill('Evening briefing')
  await expect(rename.getByText('$ hermes sessions rename s-default-1 "Evening briefing"')).toBeVisible()
  await ok.click()
  await expect(detail().getByText('Session renamed')).toBeVisible()
  expect(srv.hermes.sessionCalls.at(-1)).toEqual(['sessions', 'rename', 's-default-1', 'Evening briefing'])
})

test('a failing command stays in the dialog with the message from Hermes', async () => {
  srv.hermes.failOn['sessions'] = 'no such session'
  await detail().getByRole('button', { name: 'Rename' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename session' })
  await rename.getByLabel('New title').fill('Nope')
  await rename.getByRole('button', { name: 'Rename session' }).click()
  await expect(rename.getByRole('alert')).toHaveText('no such session')
  await rename.getByRole('button', { name: 'Cancel' }).click()
  delete srv.hermes.failOn['sessions']
})

test('export builds the file on this computer and saves it where the user chose', async () => {
  const target = join(tmp('mc-e2e-ses-out-'), 'briefing.md')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog
  }, target)
  await detail().getByRole('button', { name: /^Export/ }).click()
  await detail().getByRole('menuitem', { name: /Markdown/ }).click()
  await expect(detail().getByText(/Saved to .*Built on this computer/)).toBeVisible()
  const { readFileSync } = await import('node:fs')
  const text = readFileSync(target, 'utf8')
  expect(text).toContain('hello agent')
  expect(text).toContain('web_search')
})

test('Continue in Chat opens the Chat screen on that session', async () => {
  await detail().getByRole('button', { name: 'Continue in Chat' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Chat/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('hello agent').first()).toBeVisible({ timeout: 15_000 })
})
