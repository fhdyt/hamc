import type { CronAction, CronActionRequest } from '@shared/cron'
import { jobKey } from './lib/cron'
import { actionResultText, outputPair } from './lib/cronControl'
import { describeQueryError } from './lib/queryError'
import { useCron } from './stores/cron'

export const RUNS_LIMIT = 6
let seq = 0

const selectedJob = () => {
  const s = useCron.getState()
  return s.jobs.find((j) => jobKey(j) === s.selected) ?? null
}

/**
 * Reads the run history of the selected job. `quiet` is the timer's refresh: the list does not flip to loading and a
 * failure keeps what is on screen. An answer for a job that is no longer selected, or an older answer, is dropped.
 */
export async function loadRuns(quiet = false): Promise<void> {
  const job = selectedJob()
  if (!job) return
  const key = jobKey(job)
  const my = ++seq
  const st = useCron.getState()
  if (!quiet || st.runs?.key !== key) st.setRuns({ key, status: 'loading' })
  const res = await window.mc.cron.runs({ profile: job.profile, jobId: job.id, limit: RUNS_LIMIT })
  if (my !== seq || useCron.getState().selected !== key) return
  if (res.ok) {
    useCron.getState().setRuns({ key, status: 'ok', data: res.data })
    await loadOutputs()
  } else {
    const prev = useCron.getState().runs
    useCron.getState().setRuns({ key, status: 'error', message: describeQueryError(res.error, res.detail), data: prev?.key === key && prev.status === 'ok' ? prev.data : null })
  }
}

/** Fetches the outputs the diff of the picked run needs (the picked one and the one before), each once. */
export async function loadOutputs(): Promise<void> {
  const st = useCron.getState()
  const job = selectedJob()
  if (!job || st.runs?.status !== 'ok') return
  const pair = outputPair(st.runs.data.runs, st.picked)
  if (!pair) return
  const names = [pair.current, pair.previous].filter((n): n is string => n !== null && st.outputs[n] === undefined)
  if (names.length === 0) return
  const key = jobKey(job)
  for (const n of names) st.setOutput(n, { status: 'loading' })
  const res = await window.mc.cron.output({ profile: job.profile, jobId: job.id, names })
  if (useCron.getState().selected !== key) return
  for (const n of names) {
    if (!res.ok) {
      useCron.getState().setOutput(n, { status: 'error', message: describeQueryError(res.error, res.detail) })
      continue
    }
    const f = res.data.files.find((x) => x.name === n)
    if (!f) useCron.getState().setOutput(n, { status: 'error', message: 'The file was not returned.' })
    else if ('error' in f) useCron.getState().setOutput(n, { status: 'error', message: f.error === 'not_found' ? 'The output file is gone.' : 'The output file could not be read.' })
    else useCron.getState().setOutput(n, { status: 'ok', text: f.text, truncated: f.truncated })
  }
}

export function pickRun(i: number): Promise<void> {
  useCron.getState().pick(i)
  return loadOutputs()
}

export function askAction(action: CronAction): void {
  const job = selectedJob()
  if (!job) return
  useCron.getState().openAsk(jobKey(job), action, action === 'edit' ? (job.schedule.expr ?? job.schedule.display) : undefined)
}

/**
 * Runs the confirmed action. The panel closes at once; Run now stays "Running…" until Hermes answers. The result is
 * kept per job and the history is read again (main has already sent a fresh job snapshot).
 */
export async function confirmAction(): Promise<void> {
  const st = useCron.getState()
  const ask = st.ask
  const job = st.jobs.find((j) => jobKey(j) === ask?.key)
  if (!ask || !job) return
  const inc = job.incident
  const req: CronActionRequest = {
    action: ask.action,
    profile: job.profile,
    jobId: job.id,
    ...(ask.action === 'edit' ? { schedule: st.draft } : {}),
    ...(ask.action === 'ack' && inc ? { incidentId: inc.id } : {})
  }
  st.closeAsk()
  st.setNote(ask.key, null)
  st.setPending(ask.key, ask.action)
  let res
  try {
    res = await window.mc.cron.action(req)
  } catch (e) {
    res = { ok: false as const, error: 'failed' as const, detail: e instanceof Error ? e.message : String(e) }
  }
  useCron.getState().setPending(ask.key, null)
  useCron.getState().setNote(ask.key, { action: ask.action, ...actionResultText(res) })
  if (useCron.getState().selected !== ask.key) return
  // a finished manual run is the run to look at
  if (ask.action === 'run' && res.ok) useCron.getState().pick(0)
  await loadRuns(true)
}
