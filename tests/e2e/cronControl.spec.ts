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
const J = '09358c101c91'

test.beforeAll(async () => {
  // a manual run of the fake Hermes takes long enough to see the button say so
  process.env['MC_FAKE_CRON_RUN_S'] = '2'
  fx = buildFixture(join(tmp('mc-e2e-cronctl-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const panel = () => page.locator('section.card[aria-label="Cron jobs"]')
const dialog = () => page.getByRole('dialog', { name: 'Cron jobs' })
const detail = () => dialog().getByLabel('Job detail')
const runs = () => detail().getByRole('listbox', { name: 'Runs' }).getByRole('option')
const counts = () => dialog().getByRole('status', { name: 'Job counts' })
const row = (name: string) => dialog().locator('table.cron-table tbody tr', { hasText: name })

test('the job detail shows the open incident, the last runs and the output diff', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-cronctl-ud-')))
  await connectFresh(page, srv)
  await expect(panel().getByRole('listitem', { name: /second-brain-daily-sync.*incident open/ })).toBeVisible({ timeout: 20_000 })
  await panel().getByRole('listitem', { name: /second-brain-daily-sync/ }).click()
  const inc = detail().getByRole('group', { name: 'Incident' })
  await expect(inc).toContainText('Incident open: failed 10 runs in a row')
  await expect(inc).toContainText('ALERTED')
  await expect(inc).toContainText('timeout')
  await expect(row('second-brain-daily-sync')).toContainText('INCIDENT')

  await expect(runs()).toHaveCount(3, { timeout: 15_000 })
  await expect(runs().nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(runs().nth(0)).toContainText('FAILED')
  await expect(runs().nth(0)).toContainText('scheduled')
  await expect(runs().nth(0)).toContainText('58s')
  await expect(runs().nth(1)).toContainText('OK')
  await expect(runs().nth(2)).toContainText('UNKNOWN')
  const out = detail().getByLabel('Output lines')
  await expect(out.locator('.crun-line.add')).toHaveText(['+latest run', '+line two'])
  await expect(out.locator('.crun-line.del')).toHaveText(['−older run'])
  await expect(detail()).toContainText('changes compared with the run before')

  // the arrow keys move through the runs; the oldest output has nothing to compare with
  await runs().nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await expect(runs().nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(out).toContainText('older run')
  await expect(detail()).toContainText('oldest output shown')
  await runs().nth(2).click()
  await expect(detail()).toContainText('This run wrote no output file.')
  await page.screenshot({ path: 'tests/e2e/shots/cron-control-detail.png' })
})

test('Pause asks first with the exact command; Cancel runs nothing', async () => {
  await detail().getByRole('button', { name: 'Pause' }).click()
  const ask = detail().getByRole('group', { name: 'Pause “second-brain-daily-sync”?' })
  await expect(ask).toContainText(`$ hermes cron pause ${J}`)
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toHaveCount(0)
  expect(srv.hermes.cronCalls).toEqual([])
})

test('Pause and Resume change the job and the counts at once', async () => {
  await expect(counts()).toContainText('0 paused')
  await detail().getByRole('button', { name: 'Pause' }).click()
  await detail().getByRole('button', { name: 'Pause job' }).click()
  await expect(detail().getByRole('status')).toContainText(`Paused job: second-brain-daily-sync (${J})`, { timeout: 15_000 })
  await expect(row('second-brain-daily-sync')).toContainText('PAUSED')
  await expect(counts()).toContainText('1 paused')
  await detail().getByRole('button', { name: 'Resume' }).click()
  await detail().getByRole('button', { name: 'Resume job' }).click()
  await expect(row('second-brain-daily-sync')).toContainText('SCHEDULED', { timeout: 15_000 })
  await expect(counts()).toContainText('0 paused')
  expect(srv.hermes.cronCalls).toEqual([
    ['cron', 'pause', J],
    ['cron', 'resume', J]
  ])
})

test('Edit schedule checks the text, previews it and shows a refusal as Hermes wrote it', async () => {
  await detail().getByRole('button', { name: 'Edit schedule' }).click()
  const field = detail().getByLabel('New schedule')
  await expect(field).toHaveValue('0 23 * * *')
  await expect(detail().getByRole('button', { name: 'Save schedule' })).toBeDisabled()
  await field.fill('')
  await expect(detail()).toContainText('Enter a schedule.')
  await field.fill('bad one')
  await expect(detail()).toContainText(`$ hermes cron edit ${J} --schedule 'bad one'`)
  await detail().getByRole('button', { name: 'Save schedule' }).click()
  await expect(detail().getByRole('alert')).toContainText("Invalid schedule 'bad one'", { timeout: 15_000 })
  await detail().getByRole('button', { name: 'Edit schedule' }).click()
  await field.fill('every 2h')
  await expect(detail()).toContainText('Next runs, your time:')
  await field.press('Enter')
  await expect(row('second-brain-daily-sync')).toContainText('every 2h', { timeout: 15_000 })
})

test('Acknowledge closes the incident', async () => {
  await detail().getByRole('group', { name: 'Incident' }).getByRole('button', { name: 'Acknowledge' }).click()
  await expect(detail()).toContainText('$ hermes cron incidents ack 09358c_0a1b2c3d4e5f')
  await detail().getByRole('button', { name: 'Acknowledge' }).last().click()
  await expect(detail().getByRole('group', { name: 'Incident' })).toHaveCount(0, { timeout: 15_000 })
  await expect(row('second-brain-daily-sync')).not.toContainText('INCIDENT')
})

test('Run now is off while the job runs and adds a manual run with its output', async () => {
  await detail().getByRole('button', { name: 'Run now' }).click()
  const ask = detail().getByRole('group', { name: 'Run “second-brain-daily-sync” now?' })
  await expect(ask).toContainText('uses tokens')
  await expect(ask).toContainText(`$ hermes cron run ${J}`)
  await ask.getByRole('button', { name: 'Run job' }).click()
  await expect(detail().getByRole('button', { name: 'Running…' })).toBeDisabled()
  await expect(detail().getByRole('status')).toContainText('Ran now: succeeded.', { timeout: 20_000 })
  await expect(runs()).toHaveCount(4, { timeout: 15_000 })
  await expect(runs().nth(0)).toContainText('manual')
  await expect(runs().nth(0)).toContainText('OK')
  await expect(runs().nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(detail().getByLabel('Output lines').locator('.crun-line.add')).toContainText(['+manual run'])
  await expect(row('second-brain-daily-sync')).toContainText('OK')
  await expect(detail().getByRole('button', { name: 'Run now' })).toBeEnabled()
  await page.screenshot({ path: 'tests/e2e/shots/cron-control-run.png' })
})
