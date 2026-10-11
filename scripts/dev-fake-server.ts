import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeSsh } from '../tests/helpers/fakeSshServer'
import { advanceFixture, buildFixture } from '../tests/helpers/fixture'

const dir = mkdtempSync(join(tmpdir(), 'mc-dev-'))
const fx = buildFixture(join(dir, 'fx'))
const srv = await startFakeSsh({ fixture: fx, port: Number(process.env['FAKE_SSH_PORT'] ?? 2222) })
console.log(`fake Hermes VPS ready
  host     127.0.0.1
  port     ${srv.port}
  user     tester
  password test-pass-123
  key      ${srv.fingerprint}`)
let step = 1
setInterval(() => advanceFixture(join(dir, 'fx'), step++), 1000)
