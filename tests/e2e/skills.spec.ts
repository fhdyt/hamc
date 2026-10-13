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

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-skills-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const list = () => page.getByRole('listbox', { name: 'Skills' })
const detail = () => page.getByRole('region', { name: 'Skill detail' })

test('the Skills screen lists every skill with its origin, state and usage', async () => {
  ;({ app, page } = await launchApp(tmp('mc-e2e-skills-ud-')))
  await connectFresh(page, srv)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Skills/ }).click()
  await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible()
  await expect(list().getByRole('option')).toHaveCount(7, { timeout: 20_000 })
  await expect(page.getByText('7 skills · 4 agent-written · 1 stale · 1 archived')).toBeVisible()
  const first = list().getByRole('option').first()
  await expect(first).toContainText('pinned-helper')
  await expect(first.getByLabel('pinned')).toBeVisible()
  await expect(list().getByRole('option', { name: /arxiv-digest/ })).toContainText('agent-written')
  await expect(list().getByRole('option', { name: /arxiv-digest/ })).toContainText('14 uses')
  await expect(list().getByRole('option', { name: /notion/ })).toContainText('bundled')
  await expect(list().getByRole('option', { name: /hub-tool/ })).toContainText('from hub')
  await page.screenshot({ path: 'tests/e2e/shots/skills-library.png' })
})

test('kind chips and search narrow the list', async () => {
  const group = page.getByRole('group', { name: 'Filter' })
  await group.getByRole('button', { name: /Stale/ }).click()
  await expect(list().getByRole('option')).toHaveCount(1)
  await group.getByRole('button', { name: /Stale/ }).click()
  await group.getByRole('button', { name: /Bundled/ }).click()
  await expect(list().getByRole('option')).toHaveCount(2)
  await group.getByRole('button', { name: /Bundled/ }).click()
  await page.getByLabel('Search skills').fill('routing')
  await expect(list().getByRole('option')).toHaveCount(1)
  await expect(list().getByRole('option')).toContainText('maps')
  await page.getByLabel('Search skills').fill('')
  await expect(list().getByRole('option')).toHaveCount(7)
})

test('the detail shows facts, env names only and the rendered SKILL.md; bundled skills offer no actions', async () => {
  await list().getByRole('option', { name: /notion/ }).click()
  await expect(detail()).toContainText('2.0.0')
  await expect(detail()).toContainText('NOTION_API_KEY')
  await expect(detail()).toContainText('never reads their values')
  await expect(detail().getByRole('heading', { name: 'Notion' })).toBeVisible({ timeout: 15_000 })
  await expect(detail()).toContainText('Bundled skills are updated together with Hermes')
  await expect(detail().getByRole('button', { name: /Pin|Archive/ })).toHaveCount(0)
})

test('Pin asks first; Archive moves the skill to the archive and Restore brings it back', async () => {
  await list().getByRole('option', { name: /arxiv-digest/ }).click()
  await detail().getByRole('button', { name: 'Pin' }).click()
  const ask = detail().getByRole('group', { name: 'Pin “arxiv-digest”?' })
  await expect(ask).toContainText('$ hermes curator pin arxiv-digest')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  expect(srv.hermes.skillCalls).toEqual([])
  await detail().getByRole('button', { name: 'Pin' }).click()
  await detail().getByRole('button', { name: 'Pin skill' }).click()
  await expect(detail().getByRole('status')).toContainText("Pinned 'arxiv-digest'.", { timeout: 15_000 })
  await expect(detail().getByRole('button', { name: 'Unpin' })).toBeVisible()

  await detail().getByRole('button', { name: 'Archive' }).click()
  await detail().getByRole('button', { name: 'Archive skill' }).click()
  await expect(detail()).toContainText('archived', { timeout: 15_000 })
  await expect(detail().getByRole('button', { name: 'Restore' })).toBeVisible()
  await detail().getByRole('button', { name: 'Restore' }).click()
  await expect(detail()).toContainText('$ hermes curator restore arxiv-digest')
  await detail().getByRole('button', { name: 'Restore skill' }).click()
  await expect(detail().getByRole('button', { name: 'Archive' })).toBeVisible({ timeout: 15_000 })
  expect(srv.hermes.skillCalls).toEqual([
    ['curator', 'pin', 'arxiv-digest'],
    ['curator', 'archive', 'arxiv-digest'],
    ['curator', 'restore', 'arxiv-digest']
  ])
})

test('Install from hub inspects first, then installs after a confirm; a blocked scan is shown', async () => {
  await page.getByRole('button', { name: 'Install from hub' }).click()
  const panel = page.getByRole('region', { name: 'Install a skill' })
  await panel.getByLabel('Skill id or source').fill('--force')
  await expect(panel).toContainText('Use a hub id')
  await panel.getByLabel('Skill id or source').fill('official/web/scraper')
  await expect(panel.getByRole('button', { name: 'Install skill' })).toBeDisabled()
  await expect(panel).toContainText('$ hermes skills install official/web/scraper --yes')
  await panel.getByRole('button', { name: 'Inspect first' }).click()
  await expect(panel.getByLabel('Inspect output')).toContainText('Identifier: official/web/scraper', { timeout: 15_000 })
  await panel.getByRole('button', { name: 'Install skill' }).click()
  await panel.getByRole('group', { name: 'Install this skill?' }).getByRole('button', { name: 'Install' }).click()
  await expect(panel.getByRole('status')).toContainText("Installed 'scraper'", { timeout: 15_000 })
  await expect(list().getByRole('option', { name: /hub\/scraper/ })).toContainText('from hub', { timeout: 15_000 })

  await panel.getByLabel('Skill id or source').fill('evil/blocked-skill')
  await panel.getByRole('button', { name: 'Inspect first' }).click()
  await expect(panel.getByLabel('Inspect output')).toBeVisible({ timeout: 15_000 })
  await panel.getByRole('button', { name: 'Install skill' }).click()
  await panel.getByRole('group', { name: 'Install this skill?' }).getByRole('button', { name: 'Install' }).click()
  await expect(panel.getByRole('alert')).toContainText('security scan blocked', { timeout: 15_000 })
  await panel.getByRole('button', { name: 'Close' }).click()
})

test('the Changes tab shows the ledger with a diff and the curator status of one agent', async () => {
  await page.getByRole('tab', { name: 'Changes' }).click()
  const table = page.getByRole('region', { name: 'Skill changes' })
  await expect(table.getByRole('row', { name: /patch.*arxiv-digest/ })).toBeVisible({ timeout: 15_000 })
  await expect(table).toContainText('added cs.LG')
  await table.getByRole('row', { name: /patch.*arxiv-digest/ }).getByRole('button', { name: /diff/ }).click()
  const diff = table.getByRole('region', { name: 'Changes' })
  await expect(diff.locator('.crun-line.add')).toContainText(['+Read cs.CL and cs.LG.'])
  await expect(diff.locator('.crun-line.del')).toContainText(['−Read cs.CL.'])
  await expect(page.getByRole('region', { name: 'Curator' })).toContainText('Pick one agent')
  await page.getByRole('group', { name: 'Agent' }).getByRole('button', { name: /Hermes|default/i }).first().click()
  await expect(page.getByRole('region', { name: 'Curator' })).toContainText('Curator: enabled', { timeout: 15_000 })
  await page.screenshot({ path: 'tests/e2e/shots/skills-changes.png' })
})

test('the palette no longer says Skills comes later', async () => {
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: /command palette/i })
  await palette.getByRole('combobox').fill('skills')
  await expect(palette.getByRole('option', { name: /Skills/ }).first()).not.toContainText('Coming in a later release')
  await page.keyboard.press('Escape')
})
