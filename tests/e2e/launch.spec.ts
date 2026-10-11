import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let port: number
const userData = tmp('mc-e2e-launch-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-launch-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
  port = srv.port
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await app.close()
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })

test('an unreachable host at launch opens the dashboard in offline mode and recovers', async () => {
  const hostKey = srv.hostKey
  await srv.close()
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText(/Offline/).first()).toBeVisible({ timeout: 20_000 })
  srv = await startFakeSsh({ fixture: fx, port, hostKey })
  await expect(page.getByText(/\d+ ms/).first()).toBeVisible({ timeout: 40_000 })
  await app.close()
})

test('a changed host key at launch blocks until the new fingerprint is verified', async () => {
  await srv.close()
  srv = await startFakeSsh({ fixture: fx, port })
  ;({ app, page } = await launchApp(userData))
  const panel = page.getByRole('alertdialog', { name: 'Host key verification' })
  await expect(panel).toBeVisible({ timeout: 25_000 })
  await expect(panel).toContainText('host key changed')
  await expect(panel).toContainText(srv.fingerprint)
  await expect(mainNav()).toHaveCount(0)

  await page.getByRole('button', { name: /I verified it: trust new key/ }).click()
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await app.close()
})

test('a rejected saved password sends the user to Edit connection with the reason', async () => {
  const hostKey = srv.hostKey
  await srv.close()
  srv = await startFakeSsh({ fixture: fx, port, hostKey, password: 'changed-on-the-server' })
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByText('edit connection').first()).toBeVisible({ timeout: 25_000 })
  await expect(page.getByRole('alert').filter({ hasText: 'rejected the username or password' })).toBeVisible()
  await expect(page.getByLabel('host / public ip')).toHaveValue('127.0.0.1')
  await expect(page.getByLabel('ssh port')).toHaveValue(String(port))
  await expect(page.getByLabel(/^username/)).toHaveValue('tester')
  await page.getByLabel(/^password/).fill('changed-on-the-server')
  await page.getByRole('button', { name: /TEST & SAVE/ }).click()
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
})
