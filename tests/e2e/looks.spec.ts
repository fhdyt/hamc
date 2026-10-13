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
  fx = buildFixture(join(tmp('mc-e2e-lk-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const settings = () => page.getByRole('dialog', { name: 'Settings' })
const roster = () => page.getByRole('region', { name: /^Agents/ }).first()
const PHOTO = join(__dirname, '../../assets/brand/logo.png')

test('Profile: a local display name shows everywhere and goes back to the Hermes name', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-lk-ud-')))
  await connectFresh(page, srv)
  await page.getByRole('button', { name: 'Agent settings' }).click()
  await settings().getByRole('group', { name: 'Agents' }).getByRole('button', { name: /Scout/ }).click()
  await settings().getByRole('tab', { name: 'Profile', exact: true }).click()
  const name = settings().getByRole('textbox', { name: 'Display name' })
  await expect(name).toHaveAttribute('placeholder', 'Scout')
  await expect(settings()).toContainText('The Hermes profile on the VPS keeps its name.')
  await name.fill('  Ranger   One ')
  await name.press('Enter')
  await expect(settings().getByRole('group', { name: 'Agents' }).getByRole('button', { name: /Ranger One/ })).toBeVisible()
  await expect(name).toHaveValue('Ranger One')
  await page.keyboard.press('Escape')
  await expect(settings()).toBeHidden()
  await expect(roster()).toContainText('Ranger One')
  await expect(roster()).not.toContainText('Scout')
})

test('Profile: a photo is cropped, shown as the avatar and removed again', async () => {
  await page.getByRole('button', { name: 'Agent settings' }).click()
  await settings().getByRole('group', { name: 'Agents' }).getByRole('button', { name: /Ranger One/ }).click()
  await settings().getByRole('tab', { name: 'Profile', exact: true }).click()
  await settings().locator('input[type="file"]').setInputFiles(PHOTO)
  const remove = settings().getByRole('button', { name: 'Remove photo' })
  await expect(remove).toBeVisible({ timeout: 10_000 })
  const img = settings().locator('.lk-head img.avatar')
  await expect(img).toBeVisible()
  expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight, el.src.slice(0, 22)])).toEqual([96, 96, 'data:image/png;base64,'])
  await page.screenshot({ path: 'tests/e2e/shots/agent-profile.png' })
  await page.keyboard.press('Escape')
  await expect(roster().locator('img.avatar')).toHaveCount(1)
  await page.getByRole('button', { name: 'Agent settings' }).click()
  await settings().getByRole('group', { name: 'Agents' }).getByRole('button', { name: /Ranger One/ }).click()
  await settings().getByRole('tab', { name: 'Profile', exact: true }).click()
  await settings().getByRole('button', { name: 'Remove photo' }).click()
  await expect(settings().locator('.lk-head img.avatar')).toHaveCount(0)
  await settings().getByRole('button', { name: 'Use the profile name' }).click()
  await expect(settings().getByRole('textbox', { name: 'Display name' })).toHaveValue('')
  await expect(settings().getByRole('group', { name: 'Agents' }).getByRole('button', { name: /Scout/ })).toBeVisible()
})
