import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let api: Server
let apiUrl = ''
const userData = tmp('mc-e2e-ag-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-ag-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
  api = createServer((req, res) => {
    if (req.url === '/v1/models' && req.headers.authorization === 'Bearer e2e-key-123456') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'big-model', context_length: 128000 }, { id: 'tiny-model' }] }))
    } else res.writeHead(401).end('{}')
  })
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r))
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}/v1`
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
  api.close()
})

const settings = () => page.getByRole('dialog', { name: 'Settings' })
const agent = (name: RegExp | string) => settings().getByRole('group', { name: 'Agents' }).getByRole('button', { name })
const tab = (name: string) => settings().getByRole('tab', { name, exact: true })

async function openAgentSettings(): Promise<void> {
  await page.getByRole('button', { name: 'Agent settings' }).click()
  await expect(settings()).toBeVisible()
}

test('Soul: Create SOUL.md for an agent without one, review the diff, save, and the file is written', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await openAgentSettings()
  await agent(/Scout/).click()
  await tab('SOUL.md').click()
  await expect(settings().getByText('SOUL.md does not exist yet')).toBeVisible()
  await settings().getByRole('button', { name: 'Create SOUL.md' }).click()
  const text = settings().getByRole('textbox', { name: 'SOUL.md text' })
  await text.fill('# Scout\n\nI watch the web.')
  await expect(settings().getByText('unsaved').first()).toBeVisible()
  await settings().getByRole('button', { name: 'Save', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: 'Save SOUL.md' })
  await expect(dlg.getByText('I watch the web.')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/shots/agents-save-diff.png' })
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings().getByText(/Saved\. Changes apply to new sessions/)).toBeVisible()
  expect(readFileSync(join(fx.home, 'profiles', 'scout', 'SOUL.md'), 'utf8')).toBe('# Scout\n\nI watch the web.')
})

test('Memory: the counter turns red over 2,200 characters and Save is off', async () => {
  await tab('Memory').click()
  await expect(settings().getByRole('list', { name: 'MEMORY.md entries' })).toBeVisible()
  await settings().getByRole('button', { name: 'Add entry' }).click()
  await settings().getByRole('textbox', { name: 'Entry 1' }).fill('x'.repeat(2300))
  await expect(settings().locator('.ag-count.bad')).toContainText('2300 / 2200')
  await expect(settings().getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await settings().getByRole('textbox', { name: 'Entry 1' }).fill('Prefers short answers.')
  await expect(settings().getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
})

test('switching agent with unsaved changes asks first; Keep editing stays, Discard goes', async () => {
  await agent(/atlas/i).click()
  const ask = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Keep editing' }).click()
  await expect(settings().getByRole('textbox', { name: 'Entry 1' })).toHaveValue('Prefers short answers.')
  await agent(/atlas/i).click()
  await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard changes' }).click()
  await expect(settings().getByRole('tab', { name: 'Memory' })).toBeVisible()
  await expect(settings().getByText('Prefers short answers.')).toHaveCount(0)
})

test('a file that changed on the server is a conflict: merge keeps both edits, nothing is overwritten silently', async () => {
  await agent(/Hermes|default/i).first().click().catch(async () => {
    // the default agent may be named differently; fall back to the first in the list
    await settings().getByRole('group', { name: 'Agents' }).getByRole('button').first().click()
  })
  await tab('Memory').click()
  const entries = settings().getByRole('list', { name: 'MEMORY.md entries' })
  await expect(entries).toBeVisible()
  await settings().getByRole('button', { name: 'Raw' }).click()
  const raw = settings().getByRole('textbox', { name: 'MEMORY.md raw text' })
  const before = await raw.inputValue()
  // the agent writes the file while the user edits
  writeFileSync(join(fx.home, 'memories', 'MEMORY.md'), before + '\n§\nthe agent learned this')
  await raw.fill(before + '\n§\nI added this')
  await settings().getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('dialog', { name: 'Save MEMORY.md' }).getByRole('button', { name: 'Save', exact: true }).click()
  const conflict = page.getByRole('dialog', { name: 'MEMORY.md changed on the server' })
  await expect(conflict).toBeVisible()
  expect(readFileSync(join(fx.home, 'memories', 'MEMORY.md'), 'utf8')).toContain('the agent learned this')
  expect(readFileSync(join(fx.home, 'memories', 'MEMORY.md'), 'utf8')).not.toContain('I added this')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/shots/agents-conflict.png' })
  await conflict.getByRole('button', { name: 'Merge' }).click()
  // both inserted at the same place: Merge leaves markers and blocks Save until they are fixed
  await expect(settings().getByText(/could not be merged/)).toBeVisible()
  await expect(settings().getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await raw.fill(before + '\n§\nthe agent learned this\n§\nI added this')
  await settings().getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('dialog', { name: 'Save MEMORY.md' }).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings().getByText(/Saved\. Changes apply to new sessions/)).toBeVisible()
  const after = readFileSync(join(fx.home, 'memories', 'MEMORY.md'), 'utf8')
  expect(after).toContain('the agent learned this')
  expect(after).toContain('I added this')
})

test('Model: custom endpoint, fetch the list from the server, pick, review the commands, save', async () => {
  await tab('Model').click()
  await settings().getByRole('radio', { name: /^Custom/ }).click()
  await settings().getByLabel('Provider name').fill('e2e-proxy')
  await settings().getByLabel('Base URL').fill(apiUrl)
  await settings().getByLabel(/^API key/).fill('e2e-key-123456')
  await settings().getByRole('button', { name: 'Fetch models' }).click()
  await settings().getByRole('radio', { name: /big-model/ }).click()
  await expect(settings().getByLabel('Model ID')).toHaveValue('big-model')
  await expect(settings().getByLabel('Commands')).toContainText('providers.e2e-proxy.api')
  await expect(settings().getByLabel('Commands')).not.toContainText('e2e-key-123456')
  await settings().getByRole('button', { name: 'Save', exact: true }).click()
  const dlg = page.getByRole('dialog', { name: 'Save model settings' })
  await expect(dlg.getByText('E2E_PROXY_API_KEY')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'tests/e2e/shots/agents-model-save.png' })
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings().getByText('Saved. New sessions use this model.')).toBeVisible()
  const cfg = [...srv.hermes.config.values()].find((c) => c['providers.e2e-proxy.api'])
  expect(cfg).toMatchObject({ 'model.provider': 'e2e-proxy', 'model.default': 'big-model', 'model.base_url': apiUrl })
  expect([...srv.hermes.env.values()].some((e) => e.E2E_PROXY_API_KEY === 'e2e-key-123456')).toBe(true)
  // the key is cleared from the field and never shown again
  await expect(settings().getByLabel(/^API key/)).toHaveValue('')
})

test('Test model reports the result, and Restart gateway asks first', async () => {
  await settings().getByRole('button', { name: 'Test saved model' }).click()
  await expect(settings().getByRole('status').filter({ hasText: /✓/ })).toBeVisible({ timeout: 30_000 })
  await settings().getByRole('button', { name: /Restart this agent/ }).click()
  const dlg = page.getByRole('dialog', { name: 'Restart gateway' })
  await expect(dlg).toBeVisible()
  expect(srv.hermes.restarts).toEqual([])
  await dlg.getByRole('button', { name: 'Restart', exact: true }).click()
  await expect(dlg.getByText(/restarted/)).toBeVisible()
  expect(srv.hermes.restarts).toHaveLength(1)
})

test('v2: the Hermes catalog sets the model; an auxiliary slot is changed and set back to auto', async () => {
  mkdirSync(join(fx.home, 'cache'), { recursive: true })
  writeFileSync(
    join(fx.home, 'cache', 'model_catalog.json'),
    JSON.stringify({ version: 1, updated_at: '2026-10-01T10:00:00Z', providers: { openrouter: { models: [{ id: 'moonshotai/kimi-k3', description: 'recommended' }, { id: 'z-ai/glm-5.2', description: 'default', default: true }] } } })
  )
  // the Restart gateway dialog of the last test is still open; the catalog is read when the tab mounts again
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Restart gateway' })).toHaveCount(0)
  await tab('Memory').click()
  await tab('Model').click()
  await settings().getByRole('radio', { name: /^OpenRouter/ }).click()
  const cat = settings().getByRole('radiogroup', { name: /Hermes catalog/ })
  await expect(cat).toBeVisible({ timeout: 15_000 })
  await expect(settings().getByText("From the server's Hermes cache · updated 2026-10-01")).toBeVisible()
  await expect(cat.getByRole('radio').first()).toContainText('z-ai/glm-5.2')
  await cat.getByRole('radio', { name: /kimi-k3/ }).click()
  await expect(settings().getByLabel('Model ID').first()).toHaveValue('moonshotai/kimi-k3')

  await settings().locator('summary', { hasText: 'Auxiliary models' }).click()
  const list = settings().getByRole('list', { name: 'Auxiliary models' })
  await expect(list.getByRole('listitem')).toHaveCount(18, { timeout: 15_000 })
  await settings().getByRole('button', { name: 'Change Vision' }).click()
  const editor = settings().getByRole('group', { name: 'Vision model' })
  await editor.getByLabel('Model ID').fill('google/gemini-2.5-flash')
  await editor.getByRole('button', { name: 'Save…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Save auxiliary models' })
  await expect(dlg).toContainText(/config set auxiliary\.vision\.provider openrouter/)
  await expect(dlg).toContainText(/config set auxiliary\.vision\.base_url ''/)
  await page.screenshot({ path: 'tests/e2e/shots/agents-aux-save.png' })
  await dlg.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings().getByText('Saved. New sessions use these models.')).toBeVisible({ timeout: 15_000 })
  await expect(list.getByRole('listitem').filter({ hasText: 'Vision' })).toContainText('openrouter · google/gemini-2.5-flash')

  await settings().getByRole('button', { name: 'Use the main model for Vision' }).click()
  await page.getByRole('dialog', { name: 'Save auxiliary models' }).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(list.getByRole('listitem').filter({ hasText: 'Vision' })).toContainText('auto (main model)', { timeout: 15_000 })
  // the catalog pick is an unsaved main-model change: closing Settings asks, and Discard drops it
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Discard changes' }).click()
  await expect(settings()).toHaveCount(0)
})
