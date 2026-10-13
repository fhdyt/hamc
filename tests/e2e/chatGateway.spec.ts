import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-gw-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx, tuiGateway: true })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const conv = () => page.getByRole('region', { name: 'Conversation' })
const box = () => page.getByRole('textbox', { name: /^Message / })

async function say(text: string): Promise<void> {
  await box().fill(text)
  await box().press('Enter')
}

test('chat goes through one Hermes gateway for every message and agent', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-gw-ud-')))
  await connectFresh(page, srv)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Chat/ }).click()
  await page.locator('.dm-row').filter({ hasText: 'Scout' }).click()
  await say('hello')
  await expect(conv().locator('strong', { hasText: 'what I found' }).first()).toBeVisible({ timeout: 20_000 })
  await say('and again')
  await expect(conv().getByText(/\(turn 2\)/).first()).toBeVisible({ timeout: 20_000 })
  await page.locator('.dm-row').filter({ hasText: 'default' }).click()
  await say('hi default')
  await expect(conv().getByText(/\(turn 1\)/).first()).toBeVisible({ timeout: 20_000 })
  expect(srv.hermes.gatewayLaunches).toHaveLength(1)
  expect(srv.hermes.gatewayCalls.filter((c) => c.method === 'session.create').map((c) => c.params['profile'])).toEqual(['scout', undefined])
})

test('an approval from the gateway uses the approval card, with Allow for this session', async () => {
  await say('danger: clean the cache')
  const card = conv().getByRole('group', { name: /^Approval: Delete a folder/ })
  await expect(card).toContainText('rm -rf ~/tmp/cache', { timeout: 20_000 })
  await expect(card.getByRole('button', { name: 'Allow for this session' })).toBeVisible()
  await card.getByRole('button', { name: 'Allow once' }).click()
  await expect(conv().getByText(/Done, I ran it/)).toBeVisible({ timeout: 15_000 })
  expect(srv.hermes.gatewayCalls.find((c) => c.method === 'approval.respond')?.params).toMatchObject({ choice: 'once' })
})
