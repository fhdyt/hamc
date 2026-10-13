# M8b · Usage: design

PRD: 6.13 (F-USAGE-1..6), F-SHELL-5 (only the daily cost rule), F-NAV-8 (shared filters, made in M8a). Mockup: `mockup/src/Usage.dc.html`. The UI is English only; this document is not.

## Scope

In: the **Usage** screen with two tabs, **Cost** (stacked bars per day per agent, tables by agent and by model, threshold line) and **Tools** (calls, failures, time per tool, detail panel); a **Settings → Alerts** tab with one rule, the **daily cost alert**; the alert shown in the Dashboard Alerts tab and as a desktop notification; the shared filters from M8a.

Out: the other F-SHELL-5 rules (CPU, memory, disk, load, gateway, agent offline, cron failed as a setting; the tab is built so they can be added); a per-day link filter in Sessions (the link sets the range only); badges and the palette (M8c).

## Decisions

| Question | Choice | Why |
|---|---|---|
| Alert scope | Only the daily cost rule | Chosen by the user. Settings → Alerts holds one rule with room for more. |
| Data | On-demand read-only queries `usage_summary` and `usage_tools`, no new stream | Same pattern as Sessions; nothing runs while the screen is closed. |
| Which day is "today"? | The **user's** local day. The renderer and main send the local midnight timestamps (`dayStarts`); the collector buckets sessions by them, so DST and the VPS time zone never matter. | The Dashboard agent cards still use the VPS day (existing M3 behaviour); Usage and the alert are consistent with each other. |
| Alert evaluation | The main process runs `usage_summary` for today every 5 minutes while connected and the rule is on, and right after a settings change or a connect. | Works with the Usage screen closed, one cheap query per 5 minutes, consistent with the chart. |
| Range | `filters.range` gets a new value `14d` (`today | 7d | 14d | 30d | all`). Usage shows 7, 14 or 30 days: `today` counts as 7 and `all` as 30 without rewriting the setting. | The mockup has 7/14/30; one shared setting keeps the other screens in step. |
| Cost per model | From `sessions.model` and `sessions.billing_provider`, not from `session_model_usage` | That table's columns are unverified; the sessions columns are in the PRD. API calls use `api_call_count` when the column exists, else "—". |
| Chart | Plain SVG with fixed bars, not uPlot | Stacked bars with a pinned day, a threshold line and click targets are simpler and fully accessible as SVG. |
| Tools data | Last 20,000 tool results of the range, failures guessed from the first 400 characters of the result text, duration from the gap to the previous message of the session | PRD: best effort, stated in the UI. Bounded work on a large `state.db`. |

## Zero-Change rules that shape the design

- Both queries open `state.db` with `?mode=ro`, read `messages.active = 1` rows only, and never touch `.env` or `auth.json`. Only counts, sums and the first 400 characters of tool results leave the VPS; conversation text is never sent.
- The renderer sends numbers and profile names (day boundaries, profiles); `ipc.ts` checks them with zod (at most 31 day starts, ascending, spaced between 23 and 25 hours; profile regex). No path, SQL or command crosses the boundary.
- The alert only reads. Nothing is written on the VPS by this milestone.

## Collector (`collector/mc_collector.py`)

Two handlers in `run_query`, tolerant of missing columns (NULL), one unreadable profile goes to `errors[]` and the others answer.

### `usage_summary`

Args: `profiles[]` (empty = all), `dayStarts` (1 to 31 ascending epoch seconds, each local midnight), `endTs` (the midnight after the last day).

Per profile: `SELECT started_at, model, billing_provider, input_tokens, output_tokens, cache_read_tokens, api_call_count, estimated_cost_usd, actual_cost_usd, cost_status FROM sessions WHERE started_at >= dayStarts[0] AND started_at < endTs LIMIT 50001`. Each session is put in the day whose boundaries contain `started_at` (bisect). More than 50,000 rows sets `truncated` (the first 50,000 by `started_at DESC` are used).

Cost rule (shared with Sessions): `actual_cost_usd` when present, else `estimated_cost_usd` counted as estimated; a `cost_status` other than empty, `actual` or `estimated` means no known cost (counted in `unknownCost`).

Answer: `{ rows: [{ day: <index>, profile, provider, model, sessions, inputTokens, outputTokens, cacheReadTokens, apiCalls | null, cost, estimatedCost, unknownCost }], truncated, errors }` grouped by `(day, profile, provider, model)`, at most 5,000 rows (the cheapest groups are merged into `model: "other"` when more).

### `usage_tools`

Args: `profiles[]`, `sinceTs`, `endTs`.

Per profile: the latest 20,000 rows `role = 'tool'` with `timestamp` in range (`ORDER BY id DESC`), `substr(content, 1, 400)`, `tool_name`, `session_id`, `id`, `timestamp`. For each row the previous message of the same session is read (`id < ? ORDER BY id DESC LIMIT 1`) to get the gap in milliseconds. A result is a failure when its trimmed lowercase text starts with `error`, `traceback`, `exception` or `failed`, or contains `"error":`, or contains `exit code` followed by a non-zero number.

Answer: `{ tools: [{ name, calls, errors, avgMs, maxMs, lastTs, byProfile: {profile: calls}, failures: [{ profile, sessionId, ts, text }] }], scanned, truncated, errors }`; `failures` keeps the 5 latest per tool with the text cut to 160 characters; tools are sorted by calls descending and capped at 200.

## Main process

- `QueryCommand` gets `usage_summary` and `usage_tools`; `MissionSession.usageSummary/usageTools`; channels `mc:usage:summary`, `mc:usage:tools`; `MissionApi.usage` is added.
- `src/main/usage/costAlert.ts`: `evaluateCost(total, enabled, threshold, notifiedDay, dayKey)` is pure (returns `{ over, notify }`); `CostAlertService` owns the timer: every 5 minutes (and on `recheck()`), when connected, enabled and not already notified today it runs `usage_summary` with today's midnight, updates its state, sends `mc:ev:cost-alert` `{ day, total, threshold, over, checkedAt }` to the renderer and, when `over` first becomes true for the local day (and the window is not in front, like the cron notification), calls `notify`. The notified day is kept in memory; a new local day resets it. `reset()` runs on disconnect.
- `src/main/index.ts` shows the notification: "Daily cost over $X" with body "$Y so far today"; clicking it opens the Usage screen (`mc:ev:open-usage`).
- Settings: `alerts.cost.enabled: boolean` (default false), `alerts.cost.usd: number` (0.01 to 100000, default 10). Both are plain settings in `app.db`; `Reset settings` resets them.

## Renderer

```
screens/Usage.tsx                 header, filters, tabs, states
screens/usage/UsageFilters.tsx    agent chips (select over 8), range select (7, 14, 30 days)
screens/usage/CostTab.tsx         summary line, chart, alert note, tables
screens/usage/CostChart.tsx       SVG stacked bars, threshold line, pin a day
screens/usage/ToolsTab.tsx        sortable table and detail panel
settings/AlertsTab.tsx            the daily cost rule
stores/usage.ts, stores/costAlert.ts
usageActions.ts                   IO: loadCost, loadTools, refresh timer, recheckAlert
lib/usage.ts                      rows to days/agents/models, nice axis, labels, days over threshold, day helpers
lib/tools.ts                      sort, share bars, failure rate labels
```

- **Cost tab (F-USAGE-1..4)**: one summary line "total · average per day · today" (no big number cards). The chart has one stacked bar per day (agent colours from `agentColor`), a Y axis with 4 to 5 nice ticks (`niceTicks`), an orange threshold line when the alert is on and orange outlines on days over it. A line above the chart names the days over the threshold with a **Review in Sessions** button (sets `filters.range` to the smallest range that contains the first such day and opens Sessions). Clicking a bar pins that day (`aria-pressed`, Escape or a second click unpins); the tables follow the pinned day, else the whole range: **by agent** (sessions, input, output, cache read, cost, share) and **by model** (provider, model, API calls, cost). "est." marks any figure that includes estimates; a footnote says subscription and OAuth providers may show $0.00 and counts sessions without a known cost.
- **Tools tab (F-USAGE-5)**: table (tool, calls with a proportion bar, failure rate, average, longest, last used) sortable by calls, errors or time (`aria-sort`); clicking a row opens a detail panel with calls per agent and the latest failures; each failure has **Open session** (the Sessions screen with that session selected). A note says failures and times are guesses from the result text and timestamps, and how many results were scanned.
- **States (F-USAGE-6, F-STATE)**: loading skeleton, empty ("No usage in this range" with a button to widen the range), error with Retry (the last data stays under a `StaleBanner`), unsupported schema. The screen re-reads every 60 s while visible; stale answers are dropped with a sequence number.
- **Settings → Alerts**: a switch "Alert when the daily cost of all agents passes" and a USD field (validated 0.01 to 100000), a line saying the day is the user's local day and that the check runs every 5 minutes, and "More rules arrive in later releases". Saving applies at once (`recheckAlert()`).
- **Dashboard**: the Alerts tab lists a **COST** row ("Daily cost $Y is over $X", click opens Usage) before cron errors, and the tab count includes it. It reads `stores/costAlert.ts`, fed by `mc:ev:cost-alert`; the store resets on disconnect.

## Errors and edge cases

- A profile that fails inside a query is listed in `errors` and shown as a one-line notice; the others still count.
- `truncated` answers show a note ("Based on the latest 50,000 sessions" / "latest 20,000 tool results").
- The alert is skipped (and the state is `unknown`, no notification) while disconnected or when the query fails; the next 5-minute tick tries again. A failed check never notifies.
- A threshold at or below the current total on enabling fires one notification at the next check (that is the point of the rule); changing the threshold on the same day re-evaluates but never notifies twice for the same day.
- Days with no sessions draw an empty slot; a range with no sessions at all shows the empty state.

## Testing

- **pytest** (`tests/collector/test_usage.py`): bucketing by day boundaries (DST-sized 23 and 25 hour days), per-agent and per-model grouping, cost rules (actual over estimated, unknown status), missing columns, unreadable profile, truncation, bad args; tools: counts, failure guess cases, gap duration, per-profile counts, caps, inactive messages ignored, bad args. `make_fixture.py` gets `add_usage(fx)`: sessions spread over several days with models, providers and costs, and tool rows.
- **Vitest**: `lib/usage` (aggregation, nice ticks, threshold days, today/day helpers, range to days), `lib/tools` (sort, bars), `evaluateCost` (over, notify once per day, new day resets, disabled), store reducers, settings schema, `usageActions` stale answers, ipc arg limits through the integration test.
- **Integration** over the fake SSH server: both queries through `MissionSession`; `CostAlertService` with a fake clock and fake notifier (fires once, not while disconnected, resets on a new day); Zero-Change (fixture tree unchanged, no write verbs).
- **E2E** (`tests/e2e/usage.spec.ts`): open Usage, see the chart and tables, pin a day and see the tables follow, change range and agent, Tools tab sort and detail, enable the alert in Settings and see the COST row on the Dashboard, Review in Sessions lands on Sessions.
- **Manual** (`docs/manual-vps-checklist.md`, steps 85 onward): real columns (`billing_provider`, `api_call_count`, `cache_read_tokens`), cost figures against `hermes sessions stats`, tool name and failure text shapes on real data, speed on a large `state.db`, the notification on each OS.

## Open risks

| Risk | Handling |
|---|---|
| `billing_provider` or `api_call_count` do not exist | Provider shows "—", API calls "—"; checklist step. |
| Cost differs from the provider bill | "est." marking and the footnote (PRD risk table). |
| Large `state.db` makes `usage_tools` slow | 20,000 row cap, previous-message lookups by `session_id`/`id`, 15 s timeout, measured in the checklist. |
| Result text does not look like the failure patterns | The guess is labelled in the UI; patterns live in one function so they can be tuned. |
