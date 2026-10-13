import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-ops-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const settings = () => page.getByRole('dialog', { name: 'Settings' })
const tab = (name: string) => settings().getByRole('tab', { name, exact: true })
const agent = (name: RegExp | string) => settings().getByRole('group', { name: 'Agents' }).getByRole('button', { name })

test('MCP lists the servers by name and tests one after a confirm', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-ops-ud-')))
  await connectFresh(page, srv)
  await page.getByRole('button', { name: 'Agent settings' }).click()
  await agent(/default/i).click()
  await tab('MCP').click()
  const table = settings().getByRole('table', { name: 'MCP servers' })
  await expect(table.getByRole('row', { name: /github.*enabled/ })).toBeVisible({ timeout: 20_000 })
  await expect(table.getByRole('row', { name: /filesystem.*disabled/ })).toBeVisible()
  await expect(settings()).toContainText('Changes here apply to new sessions')
  await table.getByRole('row', { name: /github/ }).getByRole('button', { name: 'Test' }).click()
  await expect(settings().getByRole('group', { name: 'Test github?' })).toContainText('$ hermes mcp test github')
  await settings().getByRole('button', { name: 'Test server' }).click()
  await expect(settings().getByRole('status').filter({ hasText: 'Tools discovered: 12' })).toBeVisible({ timeout: 15_000 })
  await expect(settings()).toContainText('$ hermes mcp add <name> --url <endpoint>')
})

test('Toolsets holds changes in orange and applies them command by command', async () => {
  await tab('Toolsets').click()
  const matrix = settings().getByRole('table', { name: 'Toolsets per platform' })
  await expect(matrix.getByRole('checkbox', { name: 'web on cli' })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
  await expect(matrix.getByRole('checkbox', { name: 'browser on cli' })).toHaveAttribute('aria-checked', 'false')
  await matrix.getByRole('checkbox', { name: 'browser on cli' }).click()
  await expect(matrix.getByRole('checkbox', { name: 'browser on cli (not applied)' })).toHaveAttribute('aria-checked', 'true')
  await expect(settings().getByRole('group', { name: 'Changes not applied' })).toContainText('1 change not applied yet')
  await settings().getByRole('button', { name: 'Apply…' }).click()
  await expect(settings().getByRole('group', { name: 'Apply toolset changes?' })).toContainText('$ hermes tools enable browser --platform cli')
  await settings().getByRole('button', { name: 'Apply changes' }).click()
  await expect(settings().getByRole('status', { name: 'Apply results' })).toContainText('Enabled: browser', { timeout: 15_000 })
  await expect(matrix.getByRole('checkbox', { name: 'browser on cli' })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
  expect(srv.hermes.opsCalls).toContainEqual(['tools', 'enable', 'browser', '--platform', 'cli'])
  await page.screenshot({ path: 'tests/e2e/shots/agent-toolsets.png' })
})

test('Fallback shows the chain and only copies the interactive commands', async () => {
  await tab('Fallback').click()
  await expect(settings().getByRole('list', { name: 'Fallback chain' }).getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })
  await expect(settings()).toContainText('x/y  (via openrouter)')
  await expect(settings()).toContainText('$ hermes fallback add')
  expect(srv.hermes.opsCalls.some((c) => c.includes('add'))).toBe(false)
})

test('New profile previews the command, creates the profile and it joins the agent list', async () => {
  await settings().getByRole('button', { name: 'New profile' }).click()
  const dlg = page.getByRole('dialog', { name: 'New profile' })
  await dlg.getByLabel('Name').fill('Bad Name')
  await expect(dlg).toContainText('Use 2 to 24 lowercase letters')
  await dlg.getByLabel('Name').fill('research-bot')
  await dlg.getByLabel('Description (optional)').fill('Reads papers')
  await expect(dlg).toContainText("$ hermes profile create research-bot '--description=Reads papers' --no-alias")
  await dlg.getByRole('button', { name: 'Create…' }).click()
  await dlg.getByRole('button', { name: 'Create profile' }).click()
  await expect(dlg.getByRole('status')).toContainText("Created profile 'research-bot'", { timeout: 15_000 })
  await dlg.getByRole('button', { name: 'Done' }).click()
  await expect(agent(/research-bot/)).toBeVisible({ timeout: 30_000 })
})
