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

test('a reply plays the reply sound, and Off keeps it quiet', async () => {
  // count the oscillators the reply sound starts (WebAudio has no other trace in the page)
  await page.evaluate(() => {
    const w = window as unknown as { __tones: number }
    w.__tones = 0
    const orig = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__tones++
      return orig.call(this)
    }
  })
  const tones = (): Promise<number> => page.evaluate(() => (window as unknown as { __tones: number }).__tones)
  await say('one more')
  await expect(conv().getByText(/\(turn 2\)/).first()).toBeVisible({ timeout: 20_000 })
  await expect.poll(tones).toBeGreaterThan(0)
  const before = await tones()
  await page.getByRole('contentinfo', { name: 'Status bar' }).getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('tab', { name: 'Notifications' }).click()
  await settings.getByRole('group', { name: 'Reply sound' }).getByRole('button', { name: 'Off' }).click()
  await expect(settings.getByRole('group', { name: 'Reply sound tone' })).toBeHidden()
  await settings.getByRole('group', { name: 'Reply sound' }).getByRole('button', { name: 'Always' }).click()
  await settings.getByRole('group', { name: 'Tone' }).getByRole('button', { name: 'Blip' }).click()
  await expect.poll(tones).toBeGreaterThan(before) // picking a tone plays it
  await settings.getByRole('group', { name: 'Reply sound' }).getByRole('button', { name: 'Off' }).click()
  await page.keyboard.press('Escape')
  const quiet = await tones()
  await say('and a third')
  await expect(conv().getByText(/\(turn 3\)/).first()).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(500)
  expect(await tones()).toBe(quiet)
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
