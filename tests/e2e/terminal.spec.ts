import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startFakeSsh, type FakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, type FixtureDirs } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

test.describe.configure({ mode: 'serial' })

let srv: FakeSsh
let fx: FixtureDirs
let app: ElectronApplication
let page: Page
let userData: string

test.beforeAll(async () => {
  fx = buildFixture(join(tmp('mc-e2e-term-fx-'), 'fx'))
  srv = await startFakeSsh({ fixture: fx })
})
test.afterAll(async () => {
  await app?.close().catch(() => {})
  await srv.close()
})

const panel = () => page.getByRole('region', { name: 'Terminal' })
const shell = (n: number) => panel().getByRole('tabpanel', { name: `Shell ${n}` })
const screen = (n = 1) => shell(n).locator('.xterm-rows')
const sidebarTerminal = () => page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Terminal' })
const typed = (): string => srv.shells.input.join('')

const settings = () => page.getByRole('dialog', { name: 'Settings' })

/** Sets what new tabs open and how server tabs connect; answers the ssh client Settings found (null: none). */
async function terminalSettings(newTabs: 'This computer' | 'Server (SSH)', via: 'System ssh' | 'Built-in'): Promise<string | null> {
  await page.getByRole('contentinfo', { name: 'Status bar' }).getByRole('button', { name: 'Settings' }).click()
  await settings().getByRole('tab', { name: 'Terminal', exact: true }).click()
  await settings().getByRole('group', { name: 'New tabs open' }).getByRole('button', { name: newTabs }).click()
  await settings().getByRole('group', { name: 'SSH to the server with' }).getByRole('button', { name: via }).click()
  const here = settings().getByRole('region', { name: 'This computer' })
  await expect(here).toContainText('ssh:')
  const ssh = (await here.locator('code').nth(1).textContent())?.trim() ?? ''
  await page.keyboard.press('Escape')
  await expect(settings()).toBeHidden()
  return ssh && ssh !== 'not found' ? ssh : null
}

/** The rows xterm shows for tab n, one string per row. */
const rows = (n: number): Promise<string[]> => screen(n).locator(':scope > div').allTextContents()
const hasRow = async (n: number, re: RegExp): Promise<boolean> => (await rows(n)).some((r) => re.test(r))

test('the sidebar button opens a full shell that only gets what the user types', async () => {
  userData = tmp('mc-e2e-term-ud-')
  ;({ app, page } = await launchApp(userData))
  await connectFresh(page, srv)
  await expect(panel()).toBeHidden()
  // these tests drive the built-in SSH shell; local terminals and the system ssh come at the end
  await terminalSettings('Server (SSH)', 'Built-in')
  await sidebarTerminal().click()
  await expect(panel()).toBeVisible()
  await expect(screen()).toContainText('tester@fake:~$', { timeout: 15_000 })
  await expect(panel()).toContainText('Full shell on the server, not read-only')
  expect(srv.shells.ptys[0]?.term).toBe('xterm-256color')
  // F-TERM-5: opening sends nothing
  expect(srv.shells.input).toEqual([])
  await page.keyboard.type('echo hello-e2e')
  await page.keyboard.press('Enter')
  await expect(screen().locator('div', { hasText: /^hello-e2e\s*$/ })).toHaveCount(1, { timeout: 10_000 })
  expect(typed()).toBe('echo hello-e2e\r')
  await page.screenshot({ path: 'tests/e2e/shots/terminal.png' })
})

test('Ctrl+` hides the panel and shows it again with the same shell', async () => {
  await page.keyboard.press('Control+Backquote')
  await expect(panel()).toBeHidden()
  await page.keyboard.press('Control+Backquote')
  await expect(panel()).toBeVisible()
  await expect(screen()).toContainText('hello-e2e')
  expect(srv.shells.opened).toBe(1)
  await expect(sidebarTerminal()).toHaveAttribute('aria-pressed', 'true')
})

test('a second tab is its own shell, search finds text in the scrollback', async () => {
  await panel().getByRole('button', { name: 'New shell' }).click()
  await expect(screen(2)).toContainText('tester@fake:~$', { timeout: 15_000 })
  expect(srv.shells.opened).toBe(2)
  await expect(screen(2)).not.toContainText('hello-e2e')
  await panel().getByRole('tab', { name: /^Shell 1:/ }).click()
  await panel().getByRole('button', { name: 'Search the terminal' }).click()
  await panel().getByLabel('Find in terminal').fill('hello-e2e')
  await expect(panel().getByText('No match')).toBeHidden()
  await panel().getByLabel('Find in terminal').fill('nothing-like-this')
  await expect(panel().getByText('No match')).toBeVisible()
  await panel().getByLabel('Find in terminal').press('Escape')
  await expect(panel().getByLabel('Find in terminal')).toBeHidden()
  await expect(panel()).toBeVisible()
  await panel().getByRole('button', { name: 'Close shell 2' }).click()
  await expect(panel().getByRole('tab')).toHaveCount(1)
  await expect.poll(() => srv.shells.running).toBe(1)
})

test('a snippet is put on the prompt without pressing Enter', async () => {
  const before = srv.shells.input.length
  await panel().getByRole('button', { name: 'Snippets' }).click()
  await panel().getByRole('button', { name: /^Gateway status/ }).click()
  await expect.poll(() => srv.shells.input.slice(before).join('')).toBe('hermes gateway status')
  await expect(screen()).toContainText('$ hermes gateway status')
  // the user can still erase it; nothing ran
  await page.keyboard.press('Control+c')
  await expect.poll(() => srv.shells.input.slice(before).join('')).toBe('hermes gateway status\x03')
})

test('a new snippet is saved and can be removed', async () => {
  await panel().getByRole('button', { name: 'Snippets' }).click()
  await panel().getByLabel('Snippet name').fill('Uptime')
  await panel().getByLabel('Snippet command').fill('uptime')
  await panel().getByRole('button', { name: 'Add', exact: true }).click()
  await expect(panel().getByRole('button', { name: /^Uptime uptime/ })).toBeVisible()
  await panel().getByRole('button', { name: 'Remove snippet Uptime' }).click()
  await expect(panel().getByRole('button', { name: /^Uptime uptime/ })).toBeHidden()
  await panel().getByRole('button', { name: 'Snippets' }).click()
})

test('the separator changes the height and Esc outside the shell closes the panel', async () => {
  const sep = panel().getByRole('separator', { name: 'Resize terminal' })
  const h0 = Number(await sep.getAttribute('aria-valuenow'))
  await sep.focus()
  await page.keyboard.press('ArrowUp')
  await expect(sep).toHaveAttribute('aria-valuenow', String(h0 + 24))
  await page.keyboard.press('Escape')
  await expect(panel()).toBeHidden()
})

test('"Open in the terminal" in Settings closes Settings and fills the command only', async () => {
  const before = srv.shells.input.length
  await page.getByRole('button', { name: 'Agent settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('group', { name: 'Agents' }).getByRole('button', { name: /default/i }).click()
  await settings.getByRole('tab', { name: 'Fallback', exact: true }).click()
  await settings.locator('.ops-term').filter({ hasText: 'Add a fallback' }).getByRole('button', { name: 'Open in the terminal' }).click()
  await expect(settings).toBeHidden()
  await expect(panel()).toBeVisible()
  await expect.poll(() => srv.shells.input.slice(before).join('')).toBe('hermes fallback add')
  await expect(screen()).toContainText('$ hermes fallback add')
  expect(srv.hermes.opsCalls.some((c) => c.includes('add'))).toBe(false)
})

test('a dropped connection ends the shell and a new one starts after the reconnect', async () => {
  const opened = srv.shells.opened
  srv.dropConnections()
  await expect(screen()).toContainText('Connection lost', { timeout: 15_000 })
  await expect(screen()).toContainText('[Reconnected.]', { timeout: 30_000 })
  expect(srv.shells.opened).toBe(opened + 1)
  await expect(screen()).toContainText('tester@fake:~$')
})


test('a tab on this computer runs the local shell; nothing of it reaches the server', async () => {
  await terminalSettings('This computer', 'System ssh')
  if (!(await panel().isVisible())) await sidebarTerminal().click()
  const input = srv.shells.input.length
  const opened = srv.shells.opened
  await panel().getByRole('button', { name: 'New shell' }).click()
  await expect(panel().getByRole('tab', { name: /^Shell 2: .+ on this computer$/ })).toHaveAttribute('aria-selected', 'true')
  // the new shell has the keys, not the + button
  await expect(shell(2).getByRole('textbox', { name: 'Terminal input' })).toBeFocused()
  await expect(panel()).toContainText('Shell on this computer')
  // the user's own profile may draw any prompt, so wait for the shell to print something, then type
  await expect.poll(() => hasRow(2, /\S/), { timeout: 30_000 }).toBe(true)
  await page.keyboard.type('echo mc-local-e2e')
  await page.keyboard.press('Enter')
  await expect.poll(() => hasRow(2, /^mc-local-e2e\s*$/), { timeout: 15_000 }).toBe(true)
  expect(srv.shells.input.length).toBe(input)
  expect(srv.shells.opened).toBe(opened)

  // the app's connection drops and comes back: the server tab gets a new shell, the local one simply goes on
  srv.dropConnections()
  await expect.poll(() => srv.shells.opened, { timeout: 30_000 }).toBe(opened + 1)
  await expect(panel().getByRole('tab', { name: /^Shell 2: / })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.type('echo mc-local-still')
  await page.keyboard.press('Enter')
  await expect.poll(() => hasRow(2, /^mc-local-still\s*$/), { timeout: 15_000 }).toBe(true)
  await expect(shell(2)).not.toContainText('This shell has ended')

  await panel().getByRole('button', { name: 'Close shell 2' }).click()
  await expect(panel().getByRole('tab')).toHaveCount(1)
})

test('a server tab through the system ssh trusts only the key trusted in the app and leaves the password to the user', async () => {
  const ssh = await terminalSettings('Server (SSH)', 'System ssh')
  test.skip(ssh === null, 'no ssh client on this computer')
  if (!(await panel().isVisible())) await sidebarTerminal().click()
  const opened = srv.shells.opened
  await panel().getByRole('button', { name: 'New shell' }).click()
  await expect(panel().getByRole('tab', { name: /^Shell 2: ssh 2 on the server$/ })).toHaveAttribute('aria-selected', 'true')
  await expect(shell(2).getByRole('textbox', { name: 'Terminal input' })).toBeFocused()
  // ssh asks for the password, and the app does not answer it
  await expect.poll(() => hasRow(2, /password:\s*$/i), { timeout: 30_000 }).toBe(true)
  expect(srv.shells.opened).toBe(opened)
  // ssh checks the server against a file of the app holding only the key trusted at connect
  const known = readFileSync(join(userData, 'ssh_known_hosts'), 'utf8')
  expect(known).toBe(`[127.0.0.1]:${srv.port} ${srv.hostKey.public.split(' ').slice(0, 2).join(' ')}\n`)

  // the user types the (throwaway) password of the fake server
  await page.keyboard.type('test-pass-123')
  await page.keyboard.press('Enter')
  await expect.poll(() => hasRow(2, /tester@fake:~\$/), { timeout: 30_000 }).toBe(true)
  expect(srv.shells.opened).toBe(opened + 1)
  const before = srv.shells.input.length
  await page.keyboard.type('echo via-system-ssh')
  await page.keyboard.press('Enter')
  await expect.poll(() => hasRow(2, /^via-system-ssh\s*$/), { timeout: 15_000 }).toBe(true)
  expect(srv.shells.input.slice(before).join('')).toBe('echo via-system-ssh\r')
  // what was typed never lands in the app's log
  const log = readFileSync(join(userData, 'logs', 'app.log'), 'utf8')
  expect(log).toContain('terminal opened: system-ssh')
  expect(log).not.toContain('test-pass-123')
  expect(log).not.toContain('via-system-ssh')

  const running = srv.shells.running
  await panel().getByRole('button', { name: 'Close shell 2' }).click()
  await expect(panel().getByRole('tab')).toHaveCount(1)
  await expect.poll(() => srv.shells.running, { timeout: 15_000 }).toBe(running - 1)
})
