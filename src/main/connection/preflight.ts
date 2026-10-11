import type { PreflightItem, PreflightResult } from '@shared/ipc'
import type { Execer } from './manager'
import {
  findHermesCmd, homeExistsCmd, profileCountCmd, pythonVersionCmd, resolveHomeCmd,
  runSafe, shebangCmd, stateDbCmd, versionCmd
} from './remote'

export const MIN_HERMES_VERSION = '0.21.0'

export interface PreflightContext {
  host: string
  port: number
  username: string
  latencyMs: number
  fingerprint: string
}

export function parseShebang(line: string): string | null {
  const t = line.trim()
  if (!t.startsWith('#!')) return null
  const parts = t.slice(2).trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (!first) return null
  if (/(^|\/)env$/.test(first)) return parts.slice(1).find((p) => !p.startsWith('-')) ?? null
  return first
}

export function parseVersion(text: string): string | null {
  const m = /v?(\d+\.\d+(?:\.\d+)?)/.exec(text)
  return m ? m[1]! : null
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function shortFingerprint(fp: string): string {
  const prefix = 'SHA256:'
  const body = fp.startsWith(prefix) ? fp.slice(prefix.length) : fp
  return `${prefix}${body.slice(0, 4)}…${body.slice(-3)}`
}

async function resolvePython(conn: Execer, hermesPath: string | null): Promise<{ path: string; version: string } | null> {
  const candidates: string[] = []
  if (hermesPath) {
    const head = await runSafe(conn, shebangCmd(hermesPath))
    const sb = head.code === 0 ? parseShebang(head.stdout.split('\n')[0] ?? '') : null
    if (sb) candidates.push(sb)
  }
  candidates.push('python3')
  for (const c of candidates) {
    const r = await runSafe(conn, pythonVersionCmd(c))
    if (r.code !== 0) continue
    const v = parseVersion(r.stdout || r.stderr)
    if (v) return { path: c, version: v }
  }
  return null
}

export async function runPreflight(conn: Execer, ctx: PreflightContext): Promise<PreflightResult> {
  const homeRes = await runSafe(conn, resolveHomeCmd())
  const homePath = homeRes.code === 0 ? homeRes.stdout.trim() : ''
  const homeFound = homePath !== '' && (await runSafe(conn, homeExistsCmd(homePath))).code === 0

  const findRes = await runSafe(conn, findHermesCmd())
  const hermesPath = findRes.code === 0 && findRes.stdout.trim() ? findRes.stdout.trim() : null

  const verRes = hermesPath ? await runSafe(conn, versionCmd(hermesPath)) : null
  const version = verRes && verRes.code === 0 ? parseVersion(verRes.stdout || verRes.stderr) : null

  const python = await resolvePython(conn, hermesPath)

  let profileCount = 0
  if (homeFound) {
    const pc = await runSafe(conn, profileCountCmd(homePath))
    profileCount = (pc.code === 0 ? parseInt(pc.stdout.trim(), 10) || 0 : 0) + 1
  }

  const dbRes = homeFound && python ? await runSafe(conn, stateDbCmd(python.path, homePath)) : null
  const dbOut = dbRes && dbRes.code === 0 ? dbRes.stdout.trim() : ''

  const items: PreflightItem[] = [
    { id: 'ssh', label: `ssh ${ctx.username}@${ctx.host} -p ${ctx.port}`, state: 'ok', result: `OK ${ctx.latencyMs}ms` },
    { id: 'hostkey', label: `host key ${shortFingerprint(ctx.fingerprint)}`, state: 'ok', result: 'TRUSTED' },
    homeFound
      ? { id: 'home', label: 'hermes home', state: 'ok', result: homePath }
      : {
          id: 'home',
          label: 'hermes home',
          state: 'fail',
          result: 'NOT FOUND',
          hint: 'Hermes home was not found for this SSH user. Log in as the user that runs Hermes, or set HERMES_HOME for that user.'
        },
    !hermesPath
      ? { id: 'version', label: 'hermes --version', state: 'fail', result: 'UNKNOWN', hint: 'The hermes CLI was not found, so the version cannot be read.' }
      : !version
        ? { id: 'version', label: 'hermes --version', state: 'warn', result: 'UNREADABLE', hint: 'hermes --version printed no version number.' }
        : compareVersions(version, MIN_HERMES_VERSION) < 0
          ? { id: 'version', label: 'hermes --version', state: 'warn', result: `v${version}`, hint: `Tested with Hermes ${MIN_HERMES_VERSION} or newer. Some screens may not work.` }
          : { id: 'version', label: 'hermes --version', state: 'ok', result: `v${version}` },
    homeFound
      ? { id: 'profiles', label: 'profiles', state: 'ok', result: String(profileCount) }
      : { id: 'profiles', label: 'profiles', state: 'fail', result: 'SKIPPED', hint: 'Needs the Hermes home.' },
    dbOut.startsWith('ok')
      ? {
          id: 'statedb',
          label: 'state.db ?mode=ro',
          state: 'ok',
          result: /^ok\s+\S+/.test(dbOut) && !/^ok\s+None/.test(dbOut) ? `schema ${dbOut.split(/\s+/)[1]} OK` : 'readable'
        }
      : dbOut === 'missing'
        ? { id: 'statedb', label: 'state.db ?mode=ro', state: 'warn', result: 'NOT CREATED YET', hint: 'Hermes creates state.db after its first session.' }
        : { id: 'statedb', label: 'state.db ?mode=ro', state: 'fail', result: dbRes ? 'UNREADABLE' : 'SKIPPED', hint: 'state.db could not be opened read-only.' },
    hermesPath
      ? { id: 'cli', label: 'hermes cli', state: 'ok', result: hermesPath }
      : {
          id: 'cli',
          label: 'hermes cli',
          state: 'fail',
          result: 'NOT FOUND',
          hint: 'Looked in PATH, ~/.local/bin and the usual venv. Model names and capability checks will be unavailable.'
        },
    python
      ? { id: 'python', label: 'python (hermes shebang)', state: 'ok', result: python.version }
      : { id: 'python', label: 'python (hermes shebang)', state: 'fail', result: 'NOT FOUND', hint: 'No Python interpreter was found, so live monitoring cannot start.' },
    { id: 'zero', label: 'zero-change mode', state: 'info', result: 'ON · 0 files written' }
  ]

  return {
    items,
    hermesHome: homeFound ? homePath : null,
    hermesPath,
    pythonPath: python?.path ?? null,
    version,
    profileCount,
    canStart: homeFound && python !== null
  }
}
