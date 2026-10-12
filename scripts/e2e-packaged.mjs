// Runs the Playwright suite against the packaged app (npm run dist:dir first). MC_PACKAGED_EXE overrides the path,
// for example to point at an app that the installer put on disk.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const guess = {
  win32: join('dist', 'win-unpacked', 'Hermes Agent Mission Control.exe'),
  linux: join('dist', 'linux-unpacked', 'hermes-mission-control'),
  darwin: join('dist', 'mac-universal', 'Hermes Agent Mission Control.app', 'Contents', 'MacOS', 'Hermes Agent Mission Control')
}
const exe = process.env.MC_PACKAGED_EXE || resolve(guess[process.platform] ?? '')
if (!existsSync(exe)) {
  console.error(`No packaged app at ${exe}. Run "npm run dist:dir" first, or set MC_PACKAGED_EXE.`)
  process.exit(2)
}
// The suites that cover what packaging can break: native SQLite, the bundled collector, IPC, the window and the graph tabs.
const specs = process.argv.slice(2)
const args = ['playwright', 'test', ...(specs.length ? specs : ['app.spec.ts', 'dashboard.spec.ts', 'agentGraph.spec.ts', 'cron.spec.ts'])]
console.log(`Packaged app: ${exe}`)
const r = spawnSync('npx', args, { stdio: 'inherit', shell: true, env: { ...process.env, MC_PACKAGED_EXE: exe } })
process.exit(r.status ?? 1)
