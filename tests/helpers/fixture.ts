import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export const pythonExe = process.platform === 'win32' ? 'python' : 'python3'
const script = resolve('tests/fixtures/make_fixture.py')

export interface FixtureDirs {
  root: string
  proc: string
  sysfs: string
  home: string
}

export function buildFixture(dir: string): FixtureDirs {
  const out = execFileSync(pythonExe, [script, 'init', dir], { encoding: 'utf8' })
  return JSON.parse(out) as FixtureDirs
}

export function advanceFixture(dir: string, step: number): void {
  execFileSync(pythonExe, [script, 'advance', dir, String(step)])
}

export function addProfile(home: string, name: string): void {
  execFileSync(pythonExe, [script, 'add-profile', home, name])
}

/** Appends a row to a fixture state.db, like Hermes would, and returns its id. */
export function addMessage(dbPath: string, sessionId: string, role: string, content: string, ts: number): number {
  const out = execFileSync(pythonExe, [script, 'add-message', dbPath, sessionId, role, content, String(ts)], { encoding: 'utf8' })
  return Number(out.trim())
}

export function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else out[relative(dir, p)] = `${st.size}:${st.mtimeMs}:${createHash('sha256').update(readFileSync(p)).digest('hex')}`
    }
  }
  walk(dir)
  return out
}
