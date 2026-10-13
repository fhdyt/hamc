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

/** Writes (or overwrites) a note in a fixture vault, like an agent would. */
export function addNote(vault: string, rel: string, text: string): void {
  execFileSync(pythonExe, [script, 'add-note', vault, rel, text])
}

export function removeNote(vault: string, rel: string): void {
  execFileSync(pythonExe, [script, 'rm-note', vault, rel])
}

/** Creates a synthetic vault of n notes with about `links` links each (used by the graph benchmark). */
export function makeSyntheticVault(dir: string, n: number, links = 4): void {
  execFileSync(pythonExe, [script, 'synthetic-vault', dir, String(n), String(links)])
}

/** Adds Bot Chat, group room, subagent and kanban data between the fixture's profiles (pass the fixture root). */
export function addInteractions(root: string): void {
  execFileSync(pythonExe, [script, 'add-interactions', root])
}

/** Adds sessions with models, providers and costs on four irregular days from `base` (epoch seconds; pass the fixture root). */
export function addUsageData(root: string, base: number): void {
  execFileSync(pythonExe, [script, 'add-usage-data', root, String(base)])
}

/** Adds sessions with tool calls, results and a failure from `base` (epoch seconds; pass the fixture root). */
export function addToolData(root: string, base: number): void {
  execFileSync(pythonExe, [script, 'add-tool-data', root, String(base)])
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
