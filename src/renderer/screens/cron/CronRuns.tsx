import { useEffect, useMemo, type KeyboardEvent } from 'react'
import { lineDiff } from '@shared/textDiff'
import type { CronJob } from '@shared/events'
import { loadRuns, pickRun } from '../../cronActions'
import { formatLocal, jobKey } from '../../lib/cron'
import { formatRunTime, outputPair, runDuration, runStatusColor, runStatusLabel, runTime, triggerLabel } from '../../lib/cronControl'
import { useCron } from '../../stores/cron'

const LEDGER_NOTE = {
  absent: 'This Hermes keeps no run ledger, so runs are listed from their output files only.',
  unreadable: 'The run ledger could not be read, so runs are listed from their output files only.'
} as const

/** Last runs of the job (F-CRON-10) and the output of the picked one against the run before. */
export function CronRuns({ job, nowMs }: { job: CronJob; nowMs: number }) {
  const key = jobKey(job)
  const entry = useCron((s) => (s.runs?.key === key ? s.runs : null))
  const picked = useCron((s) => s.picked)
  const outputs = useCron((s) => s.outputs)
  // read again when the job changes or the collector reports a new run
  useEffect(() => {
    void loadRuns(true)
  }, [key, job.lastRunTs, job.state])

  const data = entry && entry.status !== 'loading' ? entry.data : null
  const runs = data?.runs ?? []
  const pair = outputPair(runs, picked)
  const cur = pair ? outputs[pair.current] : undefined
  const prev = pair?.previous ? outputs[pair.previous] : undefined
  const ops = useMemo(() => (cur?.status === 'ok' && prev?.status === 'ok' ? lineDiff(prev.text, cur.text) : null), [cur, prev])

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.min(runs.length - 1, Math.max(0, picked + (e.key === 'ArrowDown' ? 1 : -1)))
    void pickRun(next)
    document.getElementById(`crun-run-${key}-${next}`)?.focus()
  }

  return (
    <div className="crun-wrap">
      <span className="crun-head">Last runs</span>
      {entry?.status === 'loading' && !data && (
        <div role="status" className="cc-why">
          Loading runs…
        </div>
      )}
      {entry?.status === 'error' && (
        <div className="banner bad" role="alert">
          {entry.message}
          <button type="button" className="cb sm" onClick={() => void loadRuns()}>
            Retry
          </button>
        </div>
      )}
      {data && data.ledger !== 'ok' && <span className="cc-why">{LEDGER_NOTE[data.ledger]}</span>}
      {data && runs.length === 0 && <span className="cc-why">This job has not run yet.</span>}
      {runs.length > 0 && (
        <div role="listbox" aria-label="Runs" className="crun-list" onKeyDown={onKey}>
          {runs.map((r, i) => {
            const sel = i === picked
            const when = runTime(r)
            const dur = runDuration(r, nowMs / 1000)
            const tone = runStatusColor(r.status)
            return (
              <button
                key={r.id}
                id={`crun-run-${key}-${i}`}
                type="button"
                role="option"
                aria-selected={sel}
                tabIndex={sel ? 0 : -1}
                className="crun-run"
                title={[formatLocal(when), r.error].filter(Boolean).join(' · ')}
                onClick={() => void pickRun(i)}
              >
                <span className="crun-when">{formatRunTime(when)}</span>
                <span className="crun-meta">{triggerLabel(r.trigger)}</span>
                <span className="crun-meta num crun-dur">{dur ?? '—'}</span>
                <span className="badge" style={{ color: tone, borderColor: tone }}>
                  {runStatusLabel(r.status)}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {runs[picked]?.error && <pre className="cron-pre cc-inc-err">{runs[picked]!.error}</pre>}
      {runs.length > 0 && (
        <div className="crun-out" aria-label="Run output">
          {!pair && <span className="cc-why">This run wrote no output file.</span>}
          {pair && (
            <span className="crun-out-head">
              Output · {pair.current.split('/').pop()} · {pair.previous ? 'changes compared with the run before' : 'oldest output shown'}
            </span>
          )}
          {cur?.status === 'loading' && <span role="status" className="cc-why">Loading output…</span>}
          {cur?.status === 'error' && <span role="alert" className="cc-why bad">{cur.message}</span>}
          {cur?.status === 'ok' && (
            <div className="crun-diff" role="region" aria-label="Output lines" tabIndex={0}>
              {ops
                ? ops.map((o, i) => (
                    <div key={i} className={`crun-line ${o.t}`}>
                      <span className="crun-sign" aria-label={o.t === 'add' ? 'added' : o.t === 'del' ? 'removed' : undefined}>
                        {o.t === 'add' ? '+' : o.t === 'del' ? '−' : ' '}
                      </span>
                      {o.text}
                    </div>
                  ))
                : (cur.text || '(empty file)').split('\n').map((t, i) => (
                    <div key={i} className="crun-line same">
                      <span className="crun-sign"> </span>
                      {t}
                    </div>
                  ))}
            </div>
          )}
          {cur?.status === 'ok' && cur.truncated && <span className="cc-why">Output cut to the first 64 KiB.</span>}
          {prev?.status === 'error' && <span className="cc-why">The run before could not be read, so no changes are marked.</span>}
        </div>
      )}
    </div>
  )
}
