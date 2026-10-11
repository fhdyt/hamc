import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { addNote, buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
const userData = tmp('mc-e2e-brain-ud-')
let app: ElectronApplication
let page: Page
const vault = (): string => join(fx.root, 'home', 'vault')

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-brain-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const mainNav = () => page.getByRole('navigation', { name: 'Main' })
const stats = () => page.evaluate(() => window.__mcBrainStats?.() ?? null)
const nodePos = (id: string) =>
  page.evaluate((i) => window.__mcBrainNodes?.().find((n) => n.id === i) ?? null, id)

/** Moves the mouse onto a node of the canvas and returns the screen point. */
async function pointOf(id: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator('.brain-canvas canvas').boundingBox())!
  let p = await nodePos(id)
  for (let i = 0; i < 20 && !p; i++) {
    await page.waitForTimeout(150)
    p = await nodePos(id)
  }
  expect(p, `node ${id} on the canvas`).not.toBeNull()
  return { x: box.x + p!.x, y: box.y + p!.y }
}

/** The layout moves for a few seconds; wait until a node holds still. */
async function settled(): Promise<void> {
  await expect.poll(async () => (await stats())?.settled, { timeout: 20_000 }).toBe(true)
}

test('first visit asks for the vault folder, checks it and shows the note count', async () => {
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await mainNav().getByRole('button', { name: /^Second brain/ }).click()
  await expect(page.getByRole('heading', { name: 'Where is your vault?' })).toBeVisible({ timeout: 20_000 })
  const input = page.getByLabel('Vault folder on the server')
  await input.fill(join(fx.root, 'home', 'nowhere'))
  await expect(page.getByRole('status').filter({ hasText: 'does not exist' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use this vault' })).toBeDisabled()
  await input.fill(vault())
  await expect(page.getByRole('status').filter({ hasText: 'Found 6 notes' })).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/brain-setup.png' })
})

test('Browse lists the folders of the server and picks one', async () => {
  await page.getByLabel('Vault folder on the server').fill('')
  await page.getByRole('button', { name: 'Browse' }).click()
  const dialog = page.getByRole('dialog', { name: 'Choose the vault folder' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('list', { name: 'Folders' })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  // start from the folder above the vault and go down into it
  await page.getByLabel('Vault folder on the server').fill(join(fx.root, 'home'))
  await page.getByRole('button', { name: 'Browse' }).click()
  await expect(dialog.getByRole('button', { name: /^vault/ })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: /^vault/ }).click()
  await expect(dialog.getByRole('button', { name: /^folder/ })).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Select this folder' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByLabel('Vault folder on the server')).toHaveValue(vault())
  await expect(page.getByRole('status').filter({ hasText: 'Found 6 notes' })).toBeVisible()
  await page.getByRole('button', { name: 'Use this vault' }).click()
})

test('the graph appears with every note and a live indicator', async () => {
  await expect(page.locator('.brain-canvas canvas')).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText(/6 notes · \d+ links/)).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText('live', { exact: true })).toBeVisible()
  await expect.poll(async () => (await stats())?.nodes).toBe(7) // 6 notes + the missing "Missing Note"
  await expect.poll(async () => (await stats())?.frames, { timeout: 10_000 }).toBeGreaterThan(2)
  await settled()
  const overlapping = await page.evaluate(() => {
    const nodes = window.__mcBrainNodes!()
    return nodes.flatMap((a, i) => nodes.slice(i + 1).filter((b) => Math.hypot(a.wx - b.wx, a.wy - b.wy) < (a.wr + b.wr) * 0.9).map((b) => `${a.id} / ${b.id}`))
  })
  expect(overlapping, 'nodes that overlap').toEqual([])
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'tests/e2e/shots/brain.png' })
})

test('clicking a node opens the note with its backlinks and outgoing links', async () => {
  const p = await pointOf('Index.md')
  await page.mouse.move(p.x, p.y)
  await page.mouse.click(p.x, p.y)
  const preview = page.getByRole('complementary', { name: 'Note preview' })
  await expect(preview.getByRole('heading', { name: 'Index' })).toBeVisible()
  await expect(preview).toContainText('Start with', { timeout: 15_000 })
  await expect(preview.getByRole('region', { name: 'Backlinks' })).toContainText('Alpha')
  await expect(preview.getByRole('region', { name: 'Backlinks' })).toContainText('Gamma')
  await expect(preview.getByRole('region', { name: 'Outgoing links' })).toContainText('Beta')
  await expect(preview.locator('.tag', { hasText: '#project/x' })).toBeVisible()
  // following a wikilink in the text selects the target
  await preview.locator('a.wikilink', { hasText: 'Alpha' }).first().click()
  await expect(preview.getByRole('heading', { name: 'Alpha' })).toBeVisible()
  await page.screenshot({ path: 'tests/e2e/shots/brain-note.png' })
})

test('a missing note shows what links to it', async () => {
  const p = await pointOf('ghost:missing note')
  await page.mouse.click(p.x, p.y)
  const preview = page.getByRole('complementary', { name: 'Note preview' })
  await expect(preview.getByRole('heading', { name: 'Missing Note' })).toBeVisible()
  await expect(preview).toContainText('no file with this name')
  await expect(preview.getByRole('region', { name: 'Linked from' })).toContainText('Index')
})

test('the local graph keeps the note and its neighbours', async () => {
  await page.getByRole('button', { name: 'Index', exact: true }).first().click().catch(() => {})
  const p = await pointOf('Index.md')
  await page.mouse.click(p.x, p.y)
  await page.getByRole('complementary', { name: 'Note preview' }).getByRole('group', { name: 'Local graph' }).getByRole('button', { name: '1', exact: true }).click()
  await expect(page.getByText(/Local graph of/)).toBeVisible()
  await expect.poll(async () => (await stats())?.nodes).toBe(6) // Index, Alpha, folder/Alpha, Beta, Gamma, Missing Note
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect.poll(async () => (await stats())?.nodes).toBe(7)
})

test('a note written on the server joins the graph within seconds without moving the others', async () => {
  await settled()
  const before = await nodePos('Alpha.md')
  addNote(vault(), 'Fresh note.md', 'brand new, see [[Index]] #fresh')
  await expect(page.getByText(/7 notes · \d+ links/)).toBeVisible({ timeout: 12_000 })
  await expect.poll(async () => (await stats())?.nodes).toBe(8)
  const after = await nodePos('Alpha.md')
  expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeLessThan(120)
})

test('filters and display settings change the graph and survive a restart', async () => {
  await page.getByRole('switch', { name: 'Tags' }).check()
  await expect.poll(async () => (await stats())?.nodes).toBeGreaterThan(8)
  await page.getByRole('switch', { name: 'Existing files only' }).check()
  await page.getByLabel('Search notes').fill('alpha')
  await expect.poll(async () => (await stats())?.nodes).toBeLessThan(5)
  await page.getByLabel('Search notes').fill('')
  await page.getByRole('button', { name: 'New group' }).click()
  await page.getByLabel('Group query').fill('tag:#alpha')
  await page.waitForTimeout(700) // settings are written shortly after the last change
  await app.close()
  ;({ app, page } = await launchApp(userData))
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 })
  await mainNav().getByRole('button', { name: /^Second brain/ }).click()
  await expect(page.getByRole('switch', { name: 'Tags' })).toBeChecked({ timeout: 30_000 })
  await expect(page.getByRole('switch', { name: 'Existing files only' })).toBeChecked()
  await expect(page.getByLabel('Group query')).toHaveValue('tag:#alpha')
})

test('the Dashboard shows a compact graph and a click reads the note in a dialog', async () => {
  await mainNav().getByRole('button', { name: /^Dashboard/ }).click()
  const panel = page.locator('section.card[aria-label="Second brain"]')
  await expect(panel.locator('canvas')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await stats())?.nodes, { timeout: 20_000 }).toBeGreaterThan(5)
  await settled()
  const p = await pointOf('Index.md')
  await page.mouse.click(p.x, p.y)
  const dialog = page.getByRole('dialog', { name: 'Index' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Start with', { timeout: 15_000 })
  await page.screenshot({ path: 'tests/e2e/shots/brain-dashboard.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
