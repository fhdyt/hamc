import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { FakeSsh } from '../helpers/fakeSshServer'

/** With MC_PACKAGED_EXE set (npm run test:e2e:packaged) the suite drives the packaged app instead of out/main. */
export async function launchApp(userData: string, extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const exe = process.env['MC_PACKAGED_EXE']
  const env = { ...process.env, MC_USER_DATA: userData, NODE_ENV: 'production', MC_NO_UPDATE: '1', ...extraEnv } as Record<string, string>
  const app = await electron.launch(exe ? { executablePath: exe, args: [], env } : { args: [resolve('out/main/index.js')], env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

export const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

export async function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0]
    w?.setSize(size.width, size.height)
  }, { width, height })
}

/** Fills the first-time form with the fake server's throwaway credentials and trusts its host key. */
export async function connectFresh(page: Page, srv: FakeSsh): Promise<void> {
  await expect(page.getByText('first-time setup')).toBeVisible()
  await page.getByLabel('host / public ip').fill('127.0.0.1')
  await page.getByLabel('ssh port').fill(String(srv.port))
  await page.getByLabel(/^username/).fill('tester')
  await page.getByLabel(/^password/).fill('test-pass-123')
  await page.getByRole('button', { name: /TEST & CONNECT/ }).click()
  await expect(page.getByRole('alertdialog', { name: 'Host key verification' })).toBeVisible()
  await page.getByRole('button', { name: /TRUST & CONTINUE/ }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 25_000 })
}
