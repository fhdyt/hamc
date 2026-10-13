import type { TermSize } from '@shared/terminal'

/** The part of a node-pty terminal the Terminal panel uses (tests pass a fake). */
export interface PtyLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type SpawnPty = (file: string, args: string[], o: { size: TermSize; cwd: string; env: Record<string, string> }) => PtyLike

let loadError: string | null = null

/**
 * Starts a program in a pseudo-terminal of this computer. node-pty is loaded on the first use, so an app whose native
 * module cannot load still starts; the reason is kept for Settings → Terminal.
 */
export const spawnPty: SpawnPty = (file, args, o) => {
  let mod: typeof import('@lydell/node-pty')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@lydell/node-pty') as typeof import('@lydell/node-pty')
  } catch (e) {
    loadError = e instanceof Error ? e.message.split('\n')[0]! : String(e)
    throw new Error(`local terminals are not available: ${loadError}`)
  }
  const p = mod.spawn(file, args, { name: 'xterm-256color', cols: o.size.cols, rows: o.size.rows, cwd: o.cwd, env: o.env })
  return {
    onData: (cb) => void p.onData(cb),
    onExit: (cb) => void p.onExit(cb),
    write: (d) => p.write(d),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill()
  }
}

/** Why local terminals cannot run, once a start failed to load the module. */
export function ptyProblem(): string | null {
  if (loadError !== null) return loadError
  try {
    require.resolve('@lydell/node-pty')
    return null
  } catch (e) {
    return e instanceof Error ? e.message.split('\n')[0]! : String(e)
  }
}
