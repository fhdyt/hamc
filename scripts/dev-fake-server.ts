import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeSsh } from '../tests/helpers/fakeSshServer'
import { advanceFixture, buildFixture } from '../tests/helpers/fixture'

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'mc-dev-'))
  const fxDir = join(dir, 'fx')
  const fx = buildFixture(fxDir)
  const srv = await startFakeSsh({ fixture: fx, port: Number(process.env['FAKE_SSH_PORT'] ?? 2222), tuiGateway: process.env['FAKE_TUI_GATEWAY'] !== '0' })
  console.log(`fake Hermes VPS ready
  host     127.0.0.1
  port     ${srv.port}
  user     tester
  password test-pass-123
  key      ${srv.fingerprint}`)
  let step = 1
  setInterval(() => advanceFixture(fxDir, step++), 1000)
}

void main()
