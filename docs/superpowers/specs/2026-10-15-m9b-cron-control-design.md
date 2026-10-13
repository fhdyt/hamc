# M9b · Cron control, run history and incidents: design

PRD: 6.14 (F-CRON-7..14), F-R12-3 (everything lives in the Cron dialog of the Dashboard), F-STATE-6 (capability detection). Mockup: `mockup/src/_parts/cron.html` and `cron.js` (job detail: Pause/Resume, Run now, Edit schedule, the confirm panel with the command, the incident box, Last runs and the output diff). The UI is English only.

M9a (Logs, Gateway, Approvals) is built; this is the second half of M9.

## What the real Hermes does (read from the public source, NousResearch/hermes-agent, 2026-10-13)

The PRD asked for a spike on `cron runs` and `incidents`. The source answers most of it:

| Topic | Fact | Where |
|---|---|---|
| Commands | `cron pause <job>`, `cron resume <job>` (also `--at`, `--run-now`, not used), `cron run <job>`, `cron edit <job> --schedule <expr>`, `cron runs [job] --limit N` (alias `history`), `cron incidents [--state S] [list\|ack] [id]` | `hermes_cli/subcommands/cron.py` |
| Job reference | id or name; names are case-insensitive and an ambiguous name is refused. Ids are 12 hex characters (`uuid4().hex[:12]`) | `cron/jobs.py` |
| `cron run` | Runs the job **synchronously inside the CLI process** when no gateway hand-off applies (the CLI turns the background dispatch off on purpose). It prints `Triggered job: <name> (<id>)`, `Next run: ...` and one verdict line (`Ran now: succeeded.`, `Ran now: failed.`, `Running in background.`, or `Already being fired by the scheduler; not run again.`). Exit code 0 also when the run itself failed | `hermes_cli/cron.py` `_job_action`, `tools/cronjob_tools.py` `_action_run` |
| Hooks | `--accept-hooks` exists; without it and without a TTY an unseen shell hook is **not** approved. The app never passes it | `agent/shell_hooks.py` |
| Run ledger | `cron/executions.db` (SQLite, per profile), table `executions`: `id`, `job_id`, `source` (`builtin`, `direct`, a provider name), `status` (`claimed`, `running`, `completed`, `failed`, `unknown`), `claimed_at`, `started_at`, `finished_at` (aware ISO strings), `error`, `delivery_outcome`, `scheduled_instant` (NULL for a manual run), `progress_at`. At most 1,000 finished rows are kept | `cron/executions.py` |
| `cron runs` output | Text only, one line per attempt: `<id>  <status>  job=<job>  source=<source>  <claimed_at>` plus an error line. No duration, no output file, no `--json` | `hermes_cli/cron.py` `cron_runs` |
| Incidents | Same database, table `cron_incidents`: `id` (`<job_id[:6]>_<sig>`), `job_id`, `state` (`detected`, `alerted`, `resolved`, `closed`), `failure_type`, `first_seen_at`, `last_seen_at`, `acked_at`, `alerted_at`, `closed_at`, `error` (redacted, at most 500 characters), `output_file`. Ack sets `closed` (terminal for that error signature); a good run sets open incidents to `resolved`; the same error again re-opens a resolved one | `cron/incidents.py` |
| Output files | `cron/output/<job_id>/<YYYY-MM-DD_HH-MM-SS>.md` in the Hermes time zone, written after the run and before delivery | `cron/jobs.py` `save_job_output` |
| Running state | A run claims the job: `fire_claim` is set in `jobs.json` until the run is marked (the collector already maps it to `running`) | `cron/jobs.py` |

So the app **reads the ledger directly** (read-only, like `kanban.db` and `state.db`) instead of parsing the text of `cron runs`: the database has the duration, the trigger and the error, and needs no `hermes` start (1 to 3 s each). The CLI is used only for the five writes.

## Scope

In: in the Cron dialog's job detail, **Pause/Resume**, **Run now**, **Edit schedule** and **Acknowledge** (incident), each with a confirm that shows the exact command and the result as Hermes printed it; the **incident box** ("Incident open: failed N runs in a row", type, first and last seen, error); **Last runs** (6 newest attempts: time, trigger, duration, status as text) and the **output of the picked run with a diff against the run before** (new lines green with `+`, removed lines red with `−`); counts in the dialog header follow right after an action (F-CRON-12); Run now disabled with the reason while the job runs (F-CRON-14); an incident marker in the job table and in the Dashboard Cron panel.

Out (F-CRON-13 and later): create or remove jobs, `resume --at/--run-now`, `cron notepad`, `cron tick`, editing anything but the schedule, model per job, notifications beyond the existing failed-run alert.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Run history source | Collector query `cron_runs` reads `cron/executions.db` `?mode=ro` (columns checked with `PRAGMA table_info`) | Richer than the CLI text, no `hermes` start, Zero-Change (read-only). |
| No ledger (older Hermes) | The run list is built from the output files only (time = file time, status and trigger unknown), as the PRD fallback says | Nothing disappears on an older install. |
| Output of a run | Paired in the collector: the output file whose time falls between the run's claim (−2 s) and its finish (+5 s), closest to the finish, each file used once. Read on demand by `cron_output` (whole name from the listing, at most 64 KiB) | The file name format is not part of the ledger; times are. |
| Diff | `lineDiff` from `shared/textDiff.ts` (already used by the agent editors), folded with context 2; "oldest run shown" when there is no older output | One diff implementation in the app. |
| Job reference in commands | Always the job **id** (never the name) | Ids are unique; ambiguous names are refused by Hermes. The confirm shows the name in its title and the id in the command. |
| Who builds a command | `shared/cron.ts` `cronActionArgs(action, profile, jobId, opts)` gives the arguments after `hermes`; the renderer shows `hermes …` from it, main prepends the real path. Main also checks that the job is in its `CronStore` (the last snapshot the collector sent) and that an incident id belongs to that job (`job_id[:6]` prefix and the incident regex) | One source for preview and execution, like `buildModelPlan`; the renderer never sends a path. |
| Schedule text | 1 to 120 characters, no control characters; Hermes validates the meaning. A hint lists the accepted forms (`30m`, `every 2h`, `0 9 * * *`) and the dialog previews the next runs for 5-field and interval forms with `lib/cronExpr.ts` when it can | Hermes is the judge; the preview is a help, not a gate. |
| Run now | One SSH exec of `hermes [-p P] cron run <id>` with a 45-minute limit; the button shows "Running…" and stays disabled for that job until the exec ends or the collector reports the job no longer running. The dialog can be closed meanwhile; the result appears as a banner when the dialog is open again and in app.log | The CLI runs the job in its own process (fact above). |
| Lost connection during Run now | Said in the confirm: the run may stop when the connection drops; the ledger then shows its outcome (`unknown` or `failed`) | Over SSH without a TTY the process lives on until it writes to the closed channel. No `nohup`/`setsid`: nothing extra runs on the VPS. |
| Counts after an action | After every action main runs the read-only query `cron_jobs` (the same data as the `cron` event) and forwards it as a `cron` event, so the header counts, the table and the panel change at once | The collector has no control channel and polls jobs every 10 s. |
| Running and incidents in the snapshot | The `cron` event gains per job `inflight` (latest attempt is `claimed` or `running`) and `incident` (the newest `detected` or `alerted` incident: id, state, type, first and last seen, error). The ledger is opened only when the database or its WAL changed (size and mtime) | Run now must be disabled while a run is in flight even when `fire_claim` was missed; the table needs the incident marker. |
| Refresh of the run list | When a job is picked, every 10 s while the dialog is open and visible, and right after an action; stale answers are dropped with a sequence number | Same pattern as Kanban and Sessions. |
| Capabilities | New probe `cron incidents`; when it fails Acknowledge is disabled with "This Hermes has no `cron incidents` command". Pause, Resume, Run and Edit are older than the ledger and are not probed | F-STATE-6. |
| Action log | One app.log line per action: `cron <action> <profile> <jobId> exit <code>`; never the schedule text or output | F-STATE-3, like the gateway actions. |

## Zero-Change rules that shape the design

- Reads only: `executions.db` opened `?mode=ro` with `query_only`; output files read only from the job's own folder (`cron/output/<id>/`) or the legacy loose files `cron/output/<id>_*`/`<id>.*`, by a name from the folder listing, real path inside `cron/output`.
- The only writes are the five CLI commands, each after a confirm showing the exact command; arguments are individually quoted (`buildCommand`), the schedule is one argument and never part of a shell string.
- Never `--accept-hooks`, never `--yolo`, never `resume --run-now`.

## Collector (`collector/mc_collector.py`)

- `_cron_ledger(pdir)` → `{inflight: set(job_id), incidents: {job_id: incident}}`, cached per path on `(size, mtime)` of `executions.db` and `executions.db-wal`; absent or unreadable gives empty sets. `collect_cron` adds `inflight` and `incident` to every job.
- `--query cron_jobs {}` → the same `{jobs, profiles}` as the `cron` event.
- `--query cron_runs {profile, jobId, limit}` (limit 1 to 20, default 6) → `{ledger: 'ok'|'absent'|'unreadable', runs: [{id, status, source, trigger, claimedTs, startedTs, finishedTs, error, delivery, output}], outputs: [{name, mtime, size}], incidents: [...]}`. `trigger` is `scheduled` when `scheduled_instant` is set, `manual` when it is NULL, `null` without the column. `outputs` holds the 30 newest files by mtime. Incidents: the 10 newest of the job.
- `--query cron_output {profile, jobId, names}` (1 or 2 names from the listing) → `{files: [{name, text, truncated, mtime} | {name, error}]}`.
- Profile and job id regexes as everywhere (`PROFILE_RE`, `[A-Za-z0-9._-]{1,128}`, not `.`/`..`).

## Main process

- `src/main/cron/actions.ts` `CronActionService.run(req)`: req `{action: 'pause'|'resume'|'run'|'edit'|'ack', profile, jobId, schedule?, incidentId?}`; result `{ok: true, output} | {ok: false, error: 'bad-input'|'not-connected'|'unknown-job'|'busy'|'failed', detail?}`. ANSI colour codes are stripped from output; output is cut at 2,000 characters. A second Run now of the same job while one is in flight answers `busy`. Timeouts: 60 s, Run now 45 min.
- `MissionSession.cronAction(req)` runs it, then `refreshCron()` (`cron_jobs` → `CronStore.apply`, watcher, `mc:ev:event`). `cronRuns(args)`, `cronRunOutput(args)` are queries. The old `cron.output` (latest output via `head -c`) is replaced by `cron_output`.
- Channels `mc:cron:action`, `mc:cron:runs`, `mc:cron:run-output`; zod in `ipc.ts`.

## Renderer

```
lib/cronControl.ts         confirm texts, command preview, runNowBlock (reason), schedule check, run rows (labels, duration), incident view
stores/cron.ts             + runs (per job key), pickedRun, output (texts), ask (confirm), pending actions, result banner
cronActions.ts             loadRuns, refresh timer, loadOutputs, askAction, confirmAction (stale answers dropped)
screens/cron/CronControls.tsx   buttons, confirm panel with the command and the schedule input
screens/cron/CronIncident.tsx   the incident box and Acknowledge
screens/cron/CronRuns.tsx       Last runs listbox and the output diff
```

- The job table gets an `INCIDENT` label after the status; the Dashboard Cron panel shows a red `!` with "incident open" for such a job.
- Status words are labels (OK, ERROR, FAILED, UNKNOWN, RUNNING), never colour alone.
- Not connected: buttons disabled with "Reconnect to change jobs"; the run list shows what it had.

## Testing

- **pytest** `tests/collector/test_cron_control.py`: ledger with the real schema (fixture `add_cron_ledger`), `inflight` and `incident` in `collect_cron`, cache, `cron_runs` (order, limit, trigger, durations, output pairing, no ledger, unreadable ledger, missing columns), `cron_output` (names, 64 KiB cut, bad names, a symlink out of the folder), `cron_jobs`.
- **Vitest**: `cronActionArgs`, `CronActionService` (argv, unknown job, busy, ANSI strip, failure detail), `lib/cronControl.ts`, store and `cronActions` (stale answers, pending, refresh after action), zod schemas.
- **Integration** over the fake SSH server with a fake `hermes cron` (`tests/fixtures/fake_hermes_cron.py` changes the fixture's `jobs.json` and ledger): pause → snapshot says paused at once; run → a ledger row and an output appear; ack closes the incident; Zero-Change for the reads.
- **E2E** `tests/e2e/cronControl.spec.ts`: incident box and Acknowledge, Pause with confirm (Cancel does nothing), Run now adds a run and its diff, Edit schedule changes the table, counts follow.
- **Manual**: checklist steps 108 onward (the real ledger, a real Run now, an ambiguous name never happens because ids are used, ack, the time zone of output names).
