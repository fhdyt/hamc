import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { makeClientKey, startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

const PASSPHRASE = 'e2e passphrase 7'
let srv: FakeSsh
let fx: FixtureDirs
let port: number
let keyPath: string
const userData = tmp('mc-e2e-key-ud-')
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const dir = tmp('mc-e2e-key-')
  fx = buildFixture(join(dir, 'fx'))
  const pair = makeClientKey('ed25519', PASSPHRASE)
  keyPath = join(dir, 'id_ed25519')
  writeFileSync(keyPath, pair.private)
  srv = await startFakeSsh({ fixture: fx, publicKey: pair.public })
  port = srv.port
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })

test('first run: sign in with an encrypted private key', async () => {
  ;({ app, page } = await launchApp(userData, { MC_E2E_KEY_FILE: keyPath }))
  await expect(page.getByText('first-time setup')).toBeVisible()
  await page.getByLabel('host / public ip').fill('127.0.0.1')
  await page.getByLabel('ssh port').fill(String(port))
  await page.getByLabel(/^username/).fill('tester')
  await page.getByRole('radio', { name: 'Private key' }).click()
  await expect(page.getByLabel(/^password/)).toHaveCount(0)
  await expect(page.getByText('authorized_keys on the server')).toBeVisible()

  // connecting without a key says what is missing
  await page.getByRole('button', { name: /TEST & CONNECT/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Choose the key file.' })).toBeVisible()

  await page.getByRole('button', { name: 'Choose key file…' }).click()
  await expect(page.getByText('id_ed25519')).toBeVisible()
  await expect(page.getByText(/ED25519 · SHA256:/)).toBeVisible()
  await expect(page.getByText('(passphrase → OS keychain)')).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/connect-key.png' })
  await page.getByLabel(/^passphrase/).fill(PASSPHRASE)
  await page.getByRole('button', { name: /TEST & CONNECT/ }).click()
  await expect(page.getByRole('alertdialog', { name: 'Host key verification' })).toBeVisible()
  await page.getByRole('button', { name: /TRUST & CONTINUE/ }).click()
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await app.close()
})

test('next launch connects with the saved key and the passphrase from the keychain', async () => {
  ;({ app, page } = await launchApp(userData))
  await expect(mainNav()).toBeVisible({ timeout: 25_000 })
  await app.close()
})

test('a key the server no longer accepts opens Edit connection with the reason', async () => {
  const hostKey = srv.hostKey
  await srv.close()
  srv = await startFakeSsh({ fixture: fx, port, hostKey, publicKey: makeClientKey().public })
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('alert').filter({ hasText: 'refused this key' })).toBeVisible({ timeout: 25_000 })
  await expect(page.getByRole('radio', { name: 'Private key' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('id_ed25519')).toBeVisible()
})
