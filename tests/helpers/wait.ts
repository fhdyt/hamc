import { rmSync } from 'node:fs'

export async function waitFor<T>(
  fn: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  opts: { timeout?: number; interval?: number; label?: string } = {}
): Promise<T> {
  const { timeout = 10_000, interval = 25, label = 'condition' } = opts
  const end = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, interval))
  }
}

/** Removes a temp directory; on Windows a just-killed child process can hold files for a moment, so retry. */
export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}
