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
  fx = buildFixture(join(tmp('mc-e2e-rooms-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx, tuiGateway: true })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const conv = () => page.getByRole('region', { name: 'Room conversation' })
const box = () => page.getByRole('combobox', { name: /^Message the room/ })

async function say(text: string): Promise<void> {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
  await box().fill(text)
  await box().press('Enter')
}

test('a room of two agents: both answer in their own room session, then the room settles', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-rooms-ud-')))
  await connectFresh(page, srv)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Chat/ }).click()
  await page.getByRole('button', { name: 'New room' }).click()
  const dialog = page.getByRole('dialog', { name: 'New room' })
  await dialog.getByLabel('Name').fill('Ops')
  await expect(dialog.getByRole('button', { name: 'Create room' })).toBeDisabled()
  await dialog.locator('.gr-pick').filter({ hasText: 'default' }).click()
  await dialog.locator('.gr-pick').filter({ hasText: 'Scout' }).click()
  await dialog.getByRole('button', { name: 'Create room' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Ops' })).toBeVisible()
  await expect(conv().getByText('Start the conversation')).toBeVisible()

  await say('hello room')
  await expect(conv().getByText('default: noted.')).toBeVisible({ timeout: 30_000 })
  await expect(conv().getByText('scout: noted.')).toBeVisible({ timeout: 30_000 })
  await expect(conv().getByText(/The room settled/)).toBeVisible({ timeout: 30_000 })
  await expect(conv().getByText(/passed$/)).toBeVisible()
  const titles = srv.hermes.gatewayCalls.filter((c) => c.method === 'session.create').map((c) => c.params['title'])
  expect(titles).toHaveLength(2)
  expect(titles.every((t) => typeof t === 'string' && /^Group: mc-[a-z0-9]{10}$/.test(t))).toBe(true)
  expect(srv.hermes.gatewayCalls.filter((c) => c.method === 'session.create').every((c) => c.params['hidden'] === true)).toBe(true)
  await page.screenshot({ path: 'tests/e2e/shots/room.png' })
})

test('@ offers the agents, and a mention reaches only that agent', async () => {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
  await box().fill('@sc')
  const list = page.getByRole('listbox', { name: 'Mention an agent' })
  await expect(list.getByRole('option')).toHaveCount(1)
  await box().press('Enter')
  await expect(box()).toHaveValue('@scout ')
  await box().pressSequentially('status?')
  await box().press('Enter')
  await expect(conv().getByText('scout: on it.')).toBeVisible({ timeout: 30_000 })
  const prompts = srv.hermes.gatewayCalls.filter((c) => c.method === 'prompt.submit')
  expect(String(prompts.at(-1)!.params['text'])).toContain('You are @scout')
})

test('Stop ends a slow room turn', async () => {
  await say('slow please')
  await page.getByRole('button', { name: 'Stop the room' }).click()
  await expect(conv().getByText('Stopped.')).toBeVisible({ timeout: 30_000 })
  expect(srv.hermes.gatewayCalls.some((c) => c.method === 'session.interrupt')).toBe(true)
})

test('an agent in a room asks for approval, and Deny is sent', async () => {
  await say('@scout danger now')
  const card = conv().getByRole('group', { name: /Approval/ })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.getByRole('button', { name: 'Deny' }).click()
  await expect(conv().getByText('I was not allowed to run that.')).toBeVisible({ timeout: 30_000 })
  expect(srv.hermes.gatewayCalls.find((c) => c.method === 'approval.respond')!.params['choice']).toBe('deny')
})

test('a room can be renamed and deleted; the agents keep their own chats', async () => {
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Edit' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit room' })
  await dialog.getByLabel('Name').fill('Ops 2')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Ops 2' })).toBeVisible()
  await expect(page.locator('.gr-row').filter({ hasText: 'Ops 2' })).toBeVisible()
  // the 1:1 chat is one click away and is not the room
  await page.locator('.dm-row:not(.gr-row)').filter({ hasText: 'Scout' }).click()
  await expect(page.getByRole('region', { name: 'Conversation' })).toBeVisible()
  await page.locator('.gr-row').filter({ hasText: 'Ops 2' }).click()
  await page.getByRole('button', { name: 'Delete room' }).click()
  await page.getByRole('button', { name: 'Delete for good' }).click()
  await expect(page.locator('.gr-row')).toHaveCount(0)
  await expect(page.getByText('Talk to several agents at once.')).toBeVisible()
})
