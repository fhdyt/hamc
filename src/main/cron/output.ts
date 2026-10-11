import type { CronOutputResult } from '@shared/ipc'
import type { Execer } from '../connection/manager'
import { runSafe } from '../connection/remote'
import type { CronStore } from './store'

export const MAX_OUTPUT_BYTES = 65536

const REL = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/
const PROFILE = /^[A-Za-z0-9._-]{1,64}$/
const dotOnly = (s: string): boolean => s === '.' || s === '..'

export function isSafeRel(rel: unknown): rel is string {
  return typeof rel === 'string' && rel.length <= 300 && REL.test(rel) && !rel.split('/').some(dotOnly)
}

export function isSafeProfile(p: unknown): p is string {
  return typeof p === 'string' && PROFILE.test(p) && !dotOnly(p)
}

export function outputPath(home: string, profile: string, rel: string): string {
  const root = home.replace(/\/+$/, '')
  const base = profile === 'default' ? root : `${root}/profiles/${profile}`
  return `${base}/cron/output/${rel}`
}

/**
 * Reads the newest output of a job. The path is built here from the job the collector reported; nothing the
 * renderer sends is ever used as a path.
 */
export async function readCronOutput(
  conn: Execer,
  home: string,
  store: CronStore,
  profile: string,
  jobId: string
): Promise<CronOutputResult> {
  if (!isSafeProfile(profile)) return { ok: false, reason: 'not-found' }
  const job = store.get(profile, jobId)
  if (!job) return { ok: false, reason: 'not-found' }
  const out = job.lastOutput
  if (!out || !isSafeRel(out.rel)) return { ok: false, reason: 'no-output' }
  const r = await runSafe(conn, ['head', '-c', String(MAX_OUTPUT_BYTES), outputPath(home, profile, out.rel)], 10_000)
  if (r.code !== 0) return { ok: false, reason: 'unreadable' }
  return {
    ok: true,
    text: r.stdout,
    truncated: Buffer.byteLength(r.stdout) >= MAX_OUTPUT_BYTES,
    name: out.rel.split('/').pop() ?? out.rel,
    mtime: out.mtime
  }
}
