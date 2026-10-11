import { useEffect, useState } from 'react'
import type { CronJob } from '@shared/events'
import type { CronOutputResult } from '@shared/ipc'

export type OutputState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; result: CronOutputResult }

/** Loads the newest output of a job whenever the job, or the file the collector reports for it, changes. */
export function useCronOutput(job: CronJob | null): OutputState {
  const [state, setState] = useState<OutputState>({ status: 'idle' })
  const profile = job?.profile
  const id = job?.id
  const rel = job?.lastOutput?.rel ?? null
  const mtime = job?.lastOutput?.mtime ?? null

  useEffect(() => {
    if (!profile || !id || rel === null) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    window.mc.cron
      .output(profile, id)
      .then((result) => !cancelled && setState({ status: 'done', result }))
      .catch(() => !cancelled && setState({ status: 'done', result: { ok: false, reason: 'unreadable' } }))
    return () => {
      cancelled = true
    }
  }, [profile, id, rel, mtime])

  return state
}
