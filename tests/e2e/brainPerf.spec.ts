import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startFakeSsh } from '../helpers/fakeSshServer'
import { buildFixture, makeSyntheticVault } from '../helpers/fixture'
import { connectFresh, launchApp, tmp } from './helpers'

// Performance spike for F-BRAIN-9: a synthetic vault of N notes and about 4N links.
// Opt in with MC_PERF=1 (it writes thousands of files and takes a few minutes); N defaults to 5000.
test.skip(!process.env['MC_PERF'], 'set MC_PERF=1 to run the graph benchmark')
test.setTimeout(10 * 60_000)

const N = Number(process.env['MC_PERF_NOTES'] ?? 5000)

test(`the graph of ${N} notes stays smooth`, async () => {
  const fx = buildFixture(join(tmp('mc-perf-fx-'), 'fx'))
  const bench = join(fx.root, 'home', 'bench')
  makeSyntheticVault(bench, N, 4)
  const srv = await startFakeSsh({ fixture: fx })
  const { app, page } = await launchApp(tmp('mc-perf-ud-'))
  try {
    await connectFresh(page, srv)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: /^Second brain/ }).click()
    await page.getByLabel('Vault folder on the server').fill(bench)
    await expect(page.getByRole('status').filter({ hasText: /Found [\d,]+\+? notes/ })).toBeVisible({ timeout: 4 * 60_000 })
    await page.getByRole('button', { name: 'Use this vault' }).click()
    const t0 = Date.now()
    await expect.poll(async () => (await page.evaluate(() => window.__mcBrainStats?.().nodes)) ?? 0, { timeout: 5 * 60_000 }).toBeGreaterThanOrEqual(N)
    const firstGraphMs = Date.now() - t0

    // 1. while the layout runs
    const a = (await page.evaluate(() => window.__mcBrainStats?.()))!
    await page.waitForTimeout(3000)
    const b = (await page.evaluate(() => window.__mcBrainStats?.()))!
    const layoutFps = (b.frames - a.frames) / 3
    const tickRate = (b.ticks - a.ticks) / 3

    // 2. after it settles: zoom in and out for two seconds, as fast as the browser paints
    await expect.poll(async () => (await page.evaluate(() => window.__mcBrainStats?.().settled)) ?? false, { timeout: 5 * 60_000 }).toBe(true)
    const settled = (await page.evaluate(() => window.__mcBrainStats?.()))!
    const zoomFps = await page.evaluate(async () => {
      const canvas = document.querySelector('.brain-canvas canvas') as HTMLCanvasElement
      const r = canvas.getBoundingClientRect()
      const before = window.__mcBrainStats!().frames
      const start = performance.now()
      let i = 0
      await new Promise<void>((done) => {
        const step = (): void => {
          canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: i++ % 40 < 20 ? -60 : 60, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }))
          if (performance.now() - start < 2000) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      })
      return (window.__mcBrainStats!().frames - before) / ((performance.now() - start) / 1000)
    })

    const result = { notes: N, nodes: b.nodes, edges: b.edges, firstGraphMs, layoutFps, tickRate, settleMs: settled.settleMs, zoomFps }
    console.log('BRAIN PERF', JSON.stringify(result))
    writeFileSync('tests/e2e/shots/brain-perf.json', JSON.stringify(result, null, 2))
    await page.screenshot({ path: 'tests/e2e/shots/brain-perf.png' })
    expect(zoomFps).toBeGreaterThanOrEqual(24)
    expect(layoutFps).toBeGreaterThanOrEqual(8)
  } finally {
    await app.close().catch(() => {})
    await srv.close()
  }
})
