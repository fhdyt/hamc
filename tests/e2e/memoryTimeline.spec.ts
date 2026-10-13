import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { utimesSync, writeFileSync } from 'node:fs'
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
  fx = buildFixture(join(tmp('mc-e2e-memtl-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const versions = () => page.getByRole('listbox', { name: 'Versions' }).getByRole('option')
const changes = () => page.getByRole('region', { name: 'What changed' })

test('the memory timeline keeps a first version, then each change with what changed', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-memtl-ud-')))
  await connectFresh(page, srv)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Second brain/ }).click()
  await page.getByRole('tab', { name: 'Memory timeline' }).click()
  await page.getByRole('group', { name: 'Agent' }).getByRole('button', { name: /default/i }).click()
  await expect(versions()).toHaveCount(1, { timeout: 45_000 })
  await expect(versions().first()).toContainText('first snapshot')
  await expect(changes()).toContainText('First snapshot of this file.')

  const path = join(fx.home, 'memories', 'MEMORY.md')
  writeFileSync(path, 'm\n§\nprefers short answers\n')
  utimesSync(path, new Date(), new Date(Date.now() + 5000))
  await expect(versions()).toHaveCount(2, { timeout: 45_000 })
  await expect(versions().first()).toContainText('not attributed')
  await expect(versions().first()).toContainText('+1')
  await expect(changes().locator('.mt-line.add')).toHaveText(['+prefers short answers'])
  await changes().getByRole('button', { name: /Show 1 unchanged entry/ }).click()
  await expect(changes().locator('.mt-dim')).toHaveText([' m'])
  await page.screenshot({ path: 'tests/e2e/shots/memory-timeline.png' })
})

test('Restore in the editor loads the old version into Settings as an unsaved edit', async () => {
  await versions().nth(1).click()
  await changes().getByRole('button', { name: 'Restore in the editor' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toContainText('from the memory timeline', { timeout: 15_000 })
  await expect(dialog.getByRole('textbox').first()).toHaveValue(/^m\n?$/)
  // close Settings without saving: the restored text is only a draft, nothing was written
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard changes' }).click()
  await expect(dialog).toHaveCount(0)
  expect(srv.sftpLog.filter((op) => op.op !== 'open')).toEqual([])
})
