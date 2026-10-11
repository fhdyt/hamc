import { appendFileSync, mkdirSync, statSync, truncateSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

export function createLogger(userDataDir: string): (msg: string) => void {
  let file: string | null = null
  try {
    const dir = join(userDataDir, 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'app.log')
    try {
      if (statSync(file).size > MAX_BYTES) truncateSync(file, 0)
    } catch {
      /* new file */
    }
  } catch {
    file = null
  }
  return (msg) => {
    if (!file) return
    try {
      appendFileSync(file, `${new Date().toISOString()} ${msg.replace(/\s+/g, ' ')}\n`)
    } catch {
      /* logging must never break the app */
    }
  }
}
