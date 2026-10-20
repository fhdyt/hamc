import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addInteractions, addRemotePeers, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-ag-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-ag-fx-'), 'fx'))
  addInteractions(fx.root)
  addRemotePeers(fx.root)
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const graph = () => page.locator('section[aria-label="Agent interactions"]')

test('the agents tab draws who talks to whom and opens the detail card', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await expect(page.getByText(/\d+\/3 agents online/)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('tab', { name: 'agents' }).click()
  const msg = graph().getByRole('button', { name: /^message, atlas to scout/ })
  await expect(msg).toBeVisible({ timeout: 20_000 })
  await expect(graph().getByRole('button', { name: /^kanban, atlas to scout, #41/ })).toBeVisible()
  await expect(graph().getByRole('button', { name: 'room ops-room' })).toBeVisible()
  await expect(graph().getByRole('button', { name: 'subagent research' })).toBeVisible()
  await msg.click()
  const card = graph().getByLabel('Interaction details')
  await expect(card).toContainText('still waiting', { timeout: 15_000 })
  await expect(card).toContainText('atlas')
  await page.screenshot({ path: 'tests/e2e/shots/agent-graph.png' })
  await card.getByRole('button', { name: 'Open session' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the kinds can be turned off and a node shows its counts', async () => {
  await graph().getByRole('button', { name: 'messages' }).click()
  await expect(graph().getByRole('button', { name: /^message, atlas to scout/ })).toHaveCount(0)
  await expect(graph().getByRole('button', { name: /^kanban, atlas to scout/ })).toBeVisible()
  await graph().getByRole('button', { name: 'messages' }).click()
  await graph().getByRole('button', { name: 'agent Atlas' }).click()
  await expect(graph().getByLabel('Interaction details')).toContainText(/kanban 1 · messages 1 · rooms 1 · subagents 1/)
  await graph().getByRole('button', { name: 'Close details' }).click()
  await expect(graph().getByLabel('Interaction details')).toHaveCount(0)
})

test('agents on other machines show as remote nodes, and an edge shows its text (F-AGRAPH-7)', async () => {
  await expect(graph().getByRole('button', { name: 'remote agent dixie' })).toBeVisible()
  await expect(graph().getByRole('button', { name: 'remote agent spark/researcher' })).toBeVisible()
  await expect(graph().getByRole('button', { name: 'remote agent labbot' })).toBeVisible()
  await graph().getByRole('button', { name: /^peer, peer:dixie to default, bot chat/ }).click()
  const card = graph().getByLabel('Interaction details')
  await expect(card).toContainText('disk status on spark', { timeout: 15_000 })
  await expect(card).toContainText('remote · bot chat')
  await page.screenshot({ path: 'tests/e2e/shots/agent-graph-remote.png' })
  await graph().getByRole('button', { name: /^peer, default to peer:spark\/researcher, peer dm/ }).click()
  await expect(card).toContainText('hermes peer dm spark/researcher', { timeout: 15_000 })
  await graph().getByRole('button', { name: 'Close details' }).click()
  await graph().getByRole('button', { name: 'remote', exact: true }).click()
  await expect(graph().getByRole('button', { name: 'remote agent dixie' })).toHaveCount(0)
  await graph().getByRole('button', { name: 'remote', exact: true }).click()
  await expect(graph().getByRole('button', { name: 'remote agent dixie' })).toBeVisible()
})

test('the chosen tab is kept after a restart', async () => {
  await page.waitForTimeout(500)
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByText(/\d+\/3 agents online/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('tab', { name: 'agents' })).toHaveAttribute('aria-selected', 'true')
})
