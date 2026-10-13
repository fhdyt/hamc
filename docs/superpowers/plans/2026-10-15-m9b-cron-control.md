# M9b Cron Control Implementation Plan

**Goal:** Pause/Resume, Run now, Edit schedule and Acknowledge in the Cron dialog, with the run history and the output diff, over the real `cron/executions.db` ledger.

**Architecture:** Three read-only collector queries (`cron_jobs`, `cron_runs`, `cron_output`) plus `inflight` and `incident` in the `cron` event; five CLI writes through `CronActionService` in main, built from one shared argument builder; renderer lib, store, IO and three detail components.

**Spec:** `docs/superpowers/specs/2026-10-15-m9b-cron-control-design.md`

## Global Constraints

- UI strings are English only; replies to the user are Indonesian.
- Collector stays stdlib-only and ASCII-only; databases are opened with `open_ro`; output names come only from the folder listing.
- Every remote command is an argv array (`buildCommand` quotes each argument); never `--accept-hooks`, `--yolo` or `resume --run-now`.
- Each task ends with a commit.

## Tasks

1. **Collector.** Fixture `add_cron_ledger` (real schema of `executions` and `cron_incidents`), `_cron_ledger` with its cache, `inflight`/`incident` in `collect_cron`, queries `cron_jobs`, `cron_runs`, `cron_output`; `tests/collector/test_cron_control.py`.
2. **Shared and main.** `CronJob.inflight/incident`, `CronRuns`, `CronOutputFiles` schemas; `shared/cron.ts` `cronActionArgs`, `validSchedule`, `INCIDENT_RE`; `src/main/cron/actions.ts`; `MissionSession.cronAction/cronRuns/cronRunOutput/refreshCron`; channels, zod, preload, `MissionApi`; probe `cron incidents`; remove the old `cron.output` path. Fake `hermes cron` (`tests/fixtures/fake_hermes_cron.py`); unit and integration tests.
3. **Renderer lib and store.** `lib/cronControl.ts`, store fields, `cronActions.ts`; unit tests.
4. **Components.** `CronControls`, `CronIncident`, `CronRuns` in `CronDetail`; incident label in the table and the Dashboard panel; styles; e2e `tests/e2e/cronControl.spec.ts`.
5. **Docs and verification.** Checklist steps 108 onward, CLAUDE.md paragraph and project state, full suites.
