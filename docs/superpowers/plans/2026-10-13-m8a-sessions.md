# M8a Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sessions screen: virtualized session list, search inside messages (FTS), transcript with tool chips and parent/child chain, Continue in Chat, Pin/Unpin/Rename through the Hermes CLI, local Export, and the shared agent and range filters.

**Architecture:** Three read-only collector queries (`sessions_list`, `sessions_search`, `session_transcript`) run over the existing `--query` channel and `QueryRunner`. The main process adds a `SessionActionService` (pin, unpin, rename through `hermes`) and a native-dialog export writer. The renderer gets a store, an IO module, three pure libs and the screen. No new stream and nothing is written on the VPS except the three CLI actions the user confirms.

**Tech Stack:** Python 3 stdlib (collector, pytest), TypeScript, zod, Electron IPC, React 19, zustand, TanStack Virtual, Vitest, Playwright for Electron.

**Spec:** `docs/superpowers/specs/2026-10-13-m8a-sessions-design.md`

## Global Constraints

- UI strings are English only; replies to the user are Indonesian.
- Collector stays stdlib-only and **ASCII-only** (no `…` or other non-ASCII characters in the Python source; use `\x02`, `\x03` and `...`).
- Every `state.db` is opened with `open_ro` / `open_profile` (`?mode=ro`, `query_only`); only `messages.active = 1` rows are read.
- The renderer sends data only (profile, id, cursor, search text, action name, title); main rebuilds every command with individually quoted arguments. Never concatenate shell strings.
- `q` at most 200 characters; `limit` clamped (list 100, search 200, transcript 200); title 1 to 80 characters, no control characters.
- Never log the title of a renamed session.
- Run Python tests with `python` (not `python3`) on Windows; run Vitest with `npm test`; typecheck with `npm run typecheck`.
- Commit after every task with a message ending in `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `collector/mc_collector.py` (modify) | `q_sessions_list`, `q_sessions_search`, `q_session_transcript` and helpers; registered in `run_query` |
| `tests/fixtures/make_fixture.py` (modify) | extra session columns, `add_fts`, FTS in the default fixture |
| `tests/collector/test_sessions.py` (create) | pytest for the three queries |
| `src/shared/events.ts` (modify) | zod `SessionRow`, `SessionsList`, `SessionTranscript` |
| `src/shared/sessions.ts` (create) | arg types, title rules, command args and preview, result types |
| `src/shared/settings.ts` (modify) | `filters.agent`, `filters.range` |
| `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` (modify) | channels and `MissionApi.sessions` |
| `src/main/query.ts` (modify) | three new `QueryCommand` values |
| `src/main/ipc.ts` (modify) | zod arg schemas and handlers |
| `src/main/session.ts` (modify) | `sessionsList/Search/Transcript`, action and export methods |
| `src/main/sessions/actions.ts` (create) | `SessionActionService` |
| `src/main/sessions/export.ts` (create) | `saveExport` with a native save dialog |
| `tests/helpers/fakeHermes.ts` (modify) | fake `hermes sessions pin|unpin|rename` |
| `src/renderer/lib/sessions.ts` (create) | filter to query args, first-page merge, labels, highlight split |
| `src/renderer/lib/transcript.ts` (create) | pair tool calls with results |
| `src/renderer/lib/sessionExport.ts` (create) | jsonl, markdown, html builders |
| `src/renderer/stores/sessions.ts` (create) | list, selection, transcript state |
| `src/renderer/sessionsActions.ts` (create) | IO: load, refresh, search, open, pin, rename, export, continue |
| `src/renderer/screens/Sessions.tsx`, `screens/sessions/*` (create) | the screen |
| `src/renderer/App.tsx`, `styles/app.css` (modify) | route and styles |
| `tests/unit/*`, `tests/integration/sessions.test.ts`, `tests/e2e/sessions.spec.ts` (create) | tests |
| `docs/manual-vps-checklist.md`, `CLAUDE.md` (modify) | steps 78+ and an M8a paragraph |

---

### Task 1: Shared types, settings keys, command helpers

**Files:**
- Modify: `src/shared/events.ts`, `src/shared/settings.ts`
- Create: `src/shared/sessions.ts`
- Test: `tests/unit/sessionsShared.test.ts`

**Interfaces:**
- Produces (events.ts): `SessionStatus`, `SessionRow`, `SessionsList`, `SessionTranscript` (zod + inferred types).
- Produces (sessions.ts): `TITLE_MAX = 80`, `validTitle(t: string): string | null`, `SessionAction = 'pin' | 'unpin' | 'rename'`, `sessionCommandArgs(action, profile, id, title?): string[]` (the part after `hermes`), `sessionCommandPreview(action, profile, id, title?): string`, `SessionFilterArgs`, `SessionsListArgs`, `SessionsSearchArgs`, `TranscriptArgs`, `SessionActionResult`, `ExportExt`, `ExportResult`, `RANGES`, `Range`, `sinceFor(range, now): number | undefined`.
- Produces (settings.ts): keys `'filters.agent': string` (default `'all'`), `'filters.range': 'today' | '7d' | '30d' | 'all'` (default `'7d'`).

- [ ] **Step 1: Write the failing test** `tests/unit/sessionsShared.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMA } from '@shared/settings'
import { SessionRow, SessionsList, SessionTranscript } from '@shared/events'
import { sessionCommandArgs, sessionCommandPreview, sinceFor, validTitle } from '@shared/sessions'

const row = {
  profile: 'default', id: 's1', title: null, source: 'cli', model: null, startedAt: 1, endedAt: null, endReason: null,
  messageCount: 2, toolCallCount: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cost: null, costKind: null,
  parentSessionId: null, hasChildren: false, pinned: false, status: 'running', snippet: null
}

describe('title rules', () => {
  it('trims and accepts 1 to 80 characters', () => {
    expect(validTitle('  Morning briefing ')).toBe('Morning briefing')
    expect(validTitle('x'.repeat(80))).toBe('x'.repeat(80))
  })
  it('rejects empty, too long and control characters', () => {
    expect(validTitle('   ')).toBeNull()
    expect(validTitle('x'.repeat(81))).toBeNull()
    expect(validTitle('a\nb')).toBeNull()
    expect(validTitle('a\u0000b')).toBeNull()
  })
})

describe('command helpers', () => {
  it('builds argv without hermes, with -p for non default profiles', () => {
    expect(sessionCommandArgs('pin', 'default', 's1')).toEqual(['sessions', 'pin', 's1'])
    expect(sessionCommandArgs('unpin', 'scout', 's1')).toEqual(['-p', 'scout', 'sessions', 'unpin', 's1'])
    expect(sessionCommandArgs('rename', 'scout', 's1', 'New title')).toEqual(['-p', 'scout', 'sessions', 'rename', 's1', 'New title'])
  })
  it('previews the exact command, quoting the title', () => {
    expect(sessionCommandPreview('rename', 'scout', 's1', 'He said "hi"')).toBe('$ hermes -p scout sessions rename s1 "He said \\"hi\\""')
    expect(sessionCommandPreview('pin', 'default', 's1')).toBe('$ hermes sessions pin s1')
  })
})

describe('range', () => {
  const now = new Date(2026, 9, 13, 15, 30).getTime() / 1000
  it('maps ranges to a since timestamp', () => {
    expect(sinceFor('all', now)).toBeUndefined()
    expect(sinceFor('7d', now)).toBe(now - 7 * 86400)
    expect(sinceFor('30d', now)).toBe(now - 30 * 86400)
    expect(sinceFor('today', now)).toBe(new Date(2026, 9, 13).getTime() / 1000)
  })
})

describe('schemas', () => {
  it('parse a row, a list and a transcript', () => {
    expect(SessionRow.parse(row).status).toBe('running')
    expect(SessionsList.parse({ rows: [row], sources: ['cli'], errors: [], more: false, fallback: null }).rows).toHaveLength(1)
    expect(SessionTranscript.parse({ session: row, items: [], nextAfter: null, chain: { parent: null, children: [] }, total: 2 }).total).toBe(2)
  })
  it('settings have the shared filters', () => {
    expect(SETTINGS_DEFAULTS['filters.agent']).toBe('all')
    expect(SETTINGS_DEFAULTS['filters.range']).toBe('7d')
    expect(SETTINGS_SCHEMA['filters.range'].safeParse('year').success).toBe(false)
    expect(SETTINGS_SCHEMA['filters.agent'].safeParse('scout').success).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- tests/unit/sessionsShared.test.ts`
Expected: FAIL (cannot resolve `@shared/sessions`).

- [ ] **Step 3: Implement.** Append to `src/shared/events.ts` (after `SessionDetail`):

```ts
export const SessionStatus = z.enum(['running', 'ended', 'failed', 'compressed'])
export type SessionStatus = z.infer<typeof SessionStatus>

const OptInt = z.number().int().nullable()

export const SessionRow = z.object({
  profile: z.string(),
  id: z.string(),
  title: z.string().nullable(),
  source: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  endReason: z.string().nullable(),
  messageCount: OptInt,
  toolCallCount: OptInt,
  inputTokens: OptInt,
  outputTokens: OptInt,
  cacheReadTokens: OptInt,
  cost: z.number().nullable(),
  costKind: z.enum(['actual', 'estimated']).nullable(),
  parentSessionId: z.string().nullable(),
  hasChildren: z.boolean(),
  pinned: z.boolean(),
  status: SessionStatus,
  /** Search only: the matching text with 0x02 and 0x03 around the matched words. */
  snippet: z.string().nullable()
})
export type SessionRow = z.infer<typeof SessionRow>

export const SessionsList = z.object({
  rows: z.array(SessionRow),
  sources: z.array(z.string()),
  errors: z.array(z.object({ profile: z.string(), code: z.string() })),
  more: z.boolean(),
  /** `title` when the search could not use the message index and only looked at titles. */
  fallback: z.enum(['title']).nullable()
})
export type SessionsList = z.infer<typeof SessionsList>

export const SessionTranscript = z.object({
  session: SessionRow,
  items: z.array(FeedItem),
  nextAfter: z.number().int().nullable(),
  chain: z.object({
    parent: z.object({ id: z.string(), title: z.string().nullable() }).nullable(),
    children: z.array(z.object({ id: z.string(), title: z.string().nullable(), source: z.string().nullable() }))
  }),
  total: OptInt
})
export type SessionTranscript = z.infer<typeof SessionTranscript>
```

Create `src/shared/sessions.ts`:

```ts
export const TITLE_MAX = 80

/** The title as it will be sent, or null when it is empty, too long or holds control characters. */
export function validTitle(t: string): string | null {
  const s = t.trim()
  // eslint-disable-next-line no-control-regex
  if (s.length < 1 || s.length > TITLE_MAX || /[\u0000-\u001f\u007f]/.test(s)) return null
  return s
}

export type SessionAction = 'pin' | 'unpin' | 'rename'

/** The arguments after `hermes`. The main process builds the command from these; the renderer only shows the preview. */
export function sessionCommandArgs(action: SessionAction, profile: string, id: string, title?: string): string[] {
  const p = profile === 'default' ? [] : ['-p', profile]
  return [...p, 'sessions', action, id, ...(action === 'rename' && title !== undefined ? [title] : [])]
}

export function sessionCommandPreview(action: SessionAction, profile: string, id: string, title?: string): string {
  const parts = sessionCommandArgs(action, profile, id, title)
  const shown = parts.map((x, i) => (action === 'rename' && i === parts.length - 1 ? `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : x))
  return `$ hermes ${shown.join(' ')}`
}

export const RANGES = ['today', '7d', '30d', 'all'] as const
export type Range = (typeof RANGES)[number]

/** Start of the range in epoch seconds, or undefined for "all". */
export function sinceFor(range: Range, now: number): number | undefined {
  if (range === 'all') return undefined
  if (range === '7d') return now - 7 * 86400
  if (range === '30d') return now - 30 * 86400
  const d = new Date(now * 1000)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000
}

export interface SessionFilterArgs {
  /** Empty means every profile. */
  profiles: string[]
  source?: string
  sinceTs?: number
}
export interface SessionsListArgs extends SessionFilterArgs {
  before?: { ts: number | null; id: string }
  limit: number
}
export interface SessionsSearchArgs extends SessionFilterArgs {
  q: string
  limit: number
}
export interface TranscriptArgs {
  profile: string
  sessionId: string
  afterId?: number
  limit: number
}

export type SessionActionResult = { ok: true } | { ok: false; error: 'not-connected' | 'bad-input' | 'failed'; detail?: string }

export type ExportExt = 'jsonl' | 'md' | 'html'
export type ExportResult = { saved: string } | { canceled: true } | { failed: string }
```

In `src/shared/settings.ts`: add to `SettingsMap` `'filters.agent': string` and `'filters.range': 'today' | '7d' | '30d' | 'all'`; defaults `'filters.agent': 'all'`, `'filters.range': '7d'`; schema `'filters.agent': z.string().min(1).max(64)`, `'filters.range': z.enum(['today', '7d', '30d', 'all'])`.

- [ ] **Step 4: Run test and typecheck**

Run: `npm test -- tests/unit/sessionsShared.test.ts` then `npm run typecheck`
Expected: PASS, no type errors (other tests that enumerate settings defaults may need the two keys; fix them if `npm test` shows a failure).

- [ ] **Step 5: Commit**

```bash
git add src/shared tests/unit/sessionsShared.test.ts
git commit -m "feat(m8a): session types, title rules, command helpers and shared filter settings"
```

---

### Task 2: Collector `sessions_list` (and fixture columns)

**Files:**
- Modify: `tests/fixtures/make_fixture.py`, `collector/mc_collector.py`
- Create: `tests/collector/test_sessions.py`

**Interfaces:**
- Produces: `run_query(home, "sessions_list", json)` → `{"ok": true, "data": {"rows": [...], "sources": [...], "errors": [...], "more": bool, "fallback": null}}`. Row keys are exactly those of `SessionRow` (Task 1).
- Produces helpers used by Tasks 3 and 4: `_filters(a)`, `_limit(a, default, high)`, `_session_select(scols)`, `_session_row(profile, r, has_children, snippet=None)`, `_dict_rows(cur)`, `_children_of(con, scols, ids)`, `SESSION_COLS`.

- [ ] **Step 1: Extend the fixture.** In `make_db`, add columns to the `sessions` table: `cache_read_tokens INTEGER, end_reason TEXT, cost_status TEXT, pinned INTEGER DEFAULT 0`. Add after `add_message`:

```python
def add_fts(db: Path) -> None:
    """The message index Hermes keeps: an FTS5 table over messages.content, keyed by messages.id."""
    con = sqlite3.connect(db)
    con.execute("CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='id')")
    con.execute("INSERT INTO messages_fts(rowid, content) SELECT id, content FROM messages WHERE content IS NOT NULL")
    con.commit()
    con.close()
```

At the end of `make_fixture` (before `make_vault(fx)`), call `add_fts(d)` and `add_fts(sd)`. Also give `s-default-1` a title and pin state so tests have data: `add_session(d, "s-default-1", ..., title="Morning briefing")` is not possible via kwargs for title? It is (`**cols` does UPDATE). Add `title="Morning briefing"` to that call and `title="Digest run"` to `s-scout-1`.

- [ ] **Step 2: Write the failing tests** `tests/collector/test_sessions.py`

```python
import json
import sqlite3

import make_fixture as mf
import mc_collector as c


def q(fx, cmd, args):
    return c.run_query(str(fx.home), cmd, json.dumps(args))


def ids(r):
    return [x["id"] for x in r["data"]["rows"]]


def sql(fx, profile, stmt, *params):
    db = fx.home / "state.db" if profile == "default" else fx.home / "profiles" / profile / "state.db"
    con = sqlite3.connect(db)
    con.execute(stmt, params)
    con.commit()
    con.close()


# ---- list -----------------------------------------------------------------

def test_list_merges_profiles_newest_first(fx):
    r = q(fx, "sessions_list", {"profiles": [], "limit": 50})
    assert r["ok"] is True
    assert ids(r) == ["s-scout-child", "s-scout-1", "s-default-1", "s-default-old"]
    first = r["data"]["rows"][2]
    assert first["profile"] == "default"
    assert first["title"] == "Morning briefing"
    assert first["source"] == "telegram"
    assert first["messageCount"] == 4 and first["toolCallCount"] == 1
    assert first["inputTokens"] == 100 and first["outputTokens"] == 50
    assert first["snippet"] is None
    assert r["data"]["fallback"] is None and r["data"]["errors"] == [] and r["data"]["more"] is False


def test_list_pages_without_gaps_or_repeats(fx):
    p1 = q(fx, "sessions_list", {"profiles": [], "limit": 2})
    assert ids(p1) == ["s-scout-child", "s-scout-1"] and p1["data"]["more"] is True
    last = p1["data"]["rows"][-1]
    p2 = q(fx, "sessions_list", {"profiles": [], "limit": 2, "before": {"ts": last["startedAt"], "id": last["id"]}})
    assert ids(p2) == ["s-default-1", "s-default-old"] and p2["data"]["more"] is False


def test_list_filters(fx):
    assert ids(q(fx, "sessions_list", {"profiles": ["scout"], "limit": 50})) == ["s-scout-child", "s-scout-1"]
    assert ids(q(fx, "sessions_list", {"profiles": [], "source": "cron", "limit": 50})) == ["s-scout-1"]
    since = fx.now - 86400
    assert "s-default-old" not in ids(q(fx, "sessions_list", {"profiles": [], "sinceTs": since, "limit": 50}))
    assert q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["sources"] == ["cli", "cron", "subagent", "telegram"]


def test_cost_rules(fx):
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert (rows["s-scout-1"]["cost"], rows["s-scout-1"]["costKind"]) == (0.5, "actual")
    assert (rows["s-default-1"]["cost"], rows["s-default-1"]["costKind"]) == (0.02, "estimated")
    assert rows["s-scout-child"]["cost"] is None
    sql(fx, "default", "UPDATE sessions SET cost_status = 'weird' WHERE id = 's-default-1'")
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert rows["s-default-1"]["cost"] is None and rows["s-default-1"]["costKind"] is None


def test_status_rules(fx):
    sql(fx, "default", "UPDATE sessions SET ended_at = ?, end_reason = 'user_exit' WHERE id = 's-default-1'", fx.now - 3000)
    sql(fx, "default", "UPDATE sessions SET ended_at = ?, end_reason = 'error: timeout' WHERE id = 's-default-old'", fx.now - 3 * 86400)
    sql(fx, "scout", "UPDATE sessions SET ended_at = ?, end_reason = 'compressed' WHERE id = 's-scout-1'", fx.now - 5)
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert rows["s-default-1"]["status"] == "ended"
    assert rows["s-default-old"]["status"] == "failed"
    assert rows["s-scout-1"]["status"] == "compressed" and rows["s-scout-1"]["hasChildren"] is True
    assert rows["s-scout-child"]["status"] == "running"
    assert rows["s-scout-child"]["parentSessionId"] == "s-scout-1"


def test_pinned(fx):
    sql(fx, "default", "UPDATE sessions SET pinned = 1 WHERE id = 's-default-1'")
    rows = {x["id"]: x for x in q(fx, "sessions_list", {"profiles": [], "limit": 50})["data"]["rows"]}
    assert rows["s-default-1"]["pinned"] is True and rows["s-default-old"]["pinned"] is False


def test_missing_optional_columns_become_null(tmp_path, fx):
    db = fx.home / "profiles" / "atlas" / "state.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL)")
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
    con.execute("INSERT INTO sessions VALUES ('s-atlas', ?)", (fx.now - 1,))
    con.commit()
    con.close()
    r = q(fx, "sessions_list", {"profiles": ["atlas"], "limit": 10})
    row = r["data"]["rows"][0]
    assert row["id"] == "s-atlas" and row["title"] is None and row["cost"] is None and row["pinned"] is False and row["status"] == "running"


def test_unreadable_profile_is_reported_and_others_answer(fx):
    (fx.home / "profiles" / "atlas" / "state.db").write_bytes(b"not a database at all")
    r = q(fx, "sessions_list", {"profiles": [], "limit": 50})
    assert r["ok"] is True and "s-default-1" in ids(r)
    assert {"profile": "atlas", "code": "db_unreadable"} in r["data"]["errors"]


def test_schema_without_sessions_is_unsupported(fx):
    db = fx.home / "profiles" / "atlas" / "state.db"
    sqlite3.connect(db).execute("CREATE TABLE other (x)").connection.close()
    assert q(fx, "sessions_list", {"profiles": ["atlas"], "limit": 10}) == {"ok": False, "error": "unsupported_schema"}


def test_list_bad_args(fx):
    assert q(fx, "sessions_list", {"profiles": ["../x"], "limit": 5})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": "default", "limit": 5})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": [], "limit": 0})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": [], "limit": 5, "sinceTs": "x"})["error"] == "bad_args"
    assert q(fx, "sessions_list", {"profiles": [], "limit": 5, "before": {"ts": 1, "id": "a b"}})["error"] == "bad_args"
```

- [ ] **Step 3: Run to see them fail**

Run: `python -m pytest tests/collector/test_sessions.py -q`
Expected: FAIL (`unknown_command`).

- [ ] **Step 4: Implement** in `collector/mc_collector.py`, after `q_session` (before the `# ---- chat` banner). First look at `fetch_rows` (lines ~735) to reuse its dict-row style.

```python
# ---- sessions (M8a) --------------------------------------------------------

SESSION_COLS = ["title", "source", "model", "started_at", "ended_at", "end_reason", "message_count", "tool_call_count",
                "input_tokens", "output_tokens", "cache_read_tokens", "estimated_cost_usd", "actual_cost_usd", "cost_status",
                "parent_session_id", "pinned"]
SESSIONS_LIST_MAX = 100
SESSIONS_SEARCH_MAX = 200
SESSIONS_SOURCES_MAX = 30
TRANSCRIPT_PAGE = 200


def _dict_rows(cur):
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def _limit(a, default, high):
    v = a.get("limit", default)
    if not valid_int(v, 1):
        raise QueryError("bad_args")
    return min(v, high)


def _filters(a):
    profiles = a.get("profiles", [])
    if not isinstance(profiles, list) or len(profiles) > 50 or not all(valid_profile(p) for p in profiles):
        raise QueryError("bad_args")
    source = a.get("source")
    if source is not None and (not isinstance(source, str) or not source or len(source) > 64):
        raise QueryError("bad_args")
    since = a.get("sinceTs")
    if since is not None and (isinstance(since, bool) or not isinstance(since, (int, float))):
        raise QueryError("bad_args")
    return profiles, source, since


def _session_select(scols):
    return ", ".join(["s.id AS id"] + [("s.%s AS %s" % (c, c)) if c in scols else ("NULL AS %s" % c) for c in SESSION_COLS])


def _opt_int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    return int(v) if isinstance(v, float) else None


def _opt_num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _cost(r):
    if r.get("cost_status") not in (None, "", "actual", "estimated"):
        return None, None
    actual, est = _opt_num(r.get("actual_cost_usd")), _opt_num(r.get("estimated_cost_usd"))
    if actual is not None:
        return actual, "actual"
    if est is not None:
        return est, "estimated"
    return None, None


def _status(r, has_children):
    reason = _text(r.get("end_reason")) or ""
    if r.get("ended_at") is None and not reason:
        return "running"
    low = reason.lower()
    if "error" in low or "fail" in low or "crash" in low:
        return "failed"
    return "compressed" if has_children else "ended"


def _session_row(profile, r, has_children, snippet=None):
    cost, kind = _cost(r)
    return {
        "profile": profile, "id": r["id"], "title": _text(r.get("title"), 200), "source": _text(r.get("source"), 64),
        "model": _text(r.get("model"), 128), "startedAt": to_epoch(r.get("started_at")), "endedAt": to_epoch(r.get("ended_at")),
        "endReason": _text(r.get("end_reason"), 64), "messageCount": _opt_int(r.get("message_count")),
        "toolCallCount": _opt_int(r.get("tool_call_count")), "inputTokens": _opt_int(r.get("input_tokens")),
        "outputTokens": _opt_int(r.get("output_tokens")), "cacheReadTokens": _opt_int(r.get("cache_read_tokens")),
        "cost": cost, "costKind": kind, "parentSessionId": _text(r.get("parent_session_id"), 128),
        "hasChildren": has_children, "pinned": bool(r.get("pinned")), "status": _status(r, has_children), "snippet": snippet,
    }


def _children_of(con, scols, ids):
    if not ids or "parent_session_id" not in scols:
        return set()
    marks = ",".join("?" * len(ids))
    return {r[0] for r in con.execute("SELECT DISTINCT parent_session_id FROM sessions WHERE parent_session_id IN (%s)" % marks, ids)}


def _sort_rows(rows):
    rows.sort(key=lambda r: r["id"], reverse=True)
    rows.sort(key=lambda r: (r["startedAt"] is None, -(r["startedAt"] or 0)))


def _each_profile(home, wanted):
    for name, pdir in list_profiles(home):
        if wanted and name not in wanted:
            continue
        db = os.path.join(pdir, "state.db")
        if os.path.isfile(db):
            yield name, db


def _needs_sessions(scols):
    if not {"id", "started_at"} <= scols:
        raise QueryError("unsupported_schema")


def q_sessions_list(home, a):
    profiles, source, since = _filters(a)
    limit = _limit(a, 50, SESSIONS_LIST_MAX)
    before = a.get("before")
    if before is not None:
        if not isinstance(before, dict) or not isinstance(before.get("id"), str) or not ID_RE.match(before["id"]):
            raise QueryError("bad_args")
        bts = before.get("ts")
        if bts is not None and (isinstance(bts, bool) or not isinstance(bts, (int, float))):
            raise QueryError("bad_args")
    rows, errors, sources, readable = [], [], set(), 0
    for name, db in _each_profile(home, profiles):
        con = None
        try:
            con = open_ro(db)
            scols = table_columns(con, "sessions")
            try:
                _needs_sessions(scols)
            except QueryError:
                errors.append({"profile": name, "code": "unsupported_schema"})
                continue
            where, params = [], []
            if since is not None:
                where.append("s.started_at >= ?")
                params.append(since)
            if source is not None and "source" in scols:
                where.append("s.source = ?")
                params.append(source)
            if before is not None:
                if bts is None:
                    where.append("(s.started_at IS NULL AND s.id < ?)")
                    params.append(before["id"])
                else:
                    where.append("(s.started_at < ? OR (s.started_at = ? AND s.id < ?) OR s.started_at IS NULL)")
                    params.extend([bts, bts, before["id"]])
            sql = "SELECT %s FROM sessions s%s ORDER BY (s.started_at IS NULL), s.started_at DESC, s.id DESC LIMIT ?" % (
                _session_select(scols), (" WHERE " + " AND ".join(where)) if where else "")
            got = _dict_rows(con.execute(sql, params + [limit + 1]))
            kids = _children_of(con, scols, [g["id"] for g in got])
            rows.extend(_session_row(name, g, g["id"] in kids) for g in got)
            if "source" in scols:
                sources.update(r[0] for r in con.execute("SELECT DISTINCT source FROM sessions WHERE source IS NOT NULL ORDER BY source LIMIT ?", (SESSIONS_SOURCES_MAX,)))
            readable += 1
        except sqlite3.Error:
            errors.append({"profile": name, "code": "db_unreadable"})
        finally:
            if con is not None:
                con.close()
    if errors and readable == 0:
        raise QueryError(errors[0]["code"])
    _sort_rows(rows)
    return {"rows": rows[:limit], "sources": sorted(sources)[:SESSIONS_SOURCES_MAX], "errors": errors, "more": len(rows) > limit, "fallback": None}
```

Note: `_session_row` receives `r["id"]` and uses `.get` for the rest; `ID_RE` is the existing session-id regex. Register `"sessions_list": q_sessions_list` in the `handler` dict of `run_query`.

- [ ] **Step 5: Run tests**

Run: `python -m pytest tests/collector -q`
Expected: all pass (the new file and every existing collector test; the fixture change must not break them).

- [ ] **Step 6: Commit**

```bash
git add collector tests/fixtures tests/collector
git commit -m "feat(m8a): collector sessions_list query with merge, paging, cost and status rules"
```

---

### Task 3: Collector `sessions_search`

**Files:**
- Modify: `collector/mc_collector.py`, `tests/collector/test_sessions.py`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: `run_query(home, "sessions_search", json)` with args `{profiles, source?, sinceTs?, q, limit?}` → same shape as list; each row has `snippet` (text with `\x02`/`\x03` around matches) or `None`; `fallback` is `"title"` when any profile used the title fallback.

- [ ] **Step 1: Add failing tests**

```python
# ---- search ---------------------------------------------------------------

def test_search_finds_sessions_by_message_text_with_marked_snippet(fx):
    r = q(fx, "sessions_search", {"profiles": [], "q": "digest"})
    assert r["ok"] is True and ids(r) == ["s-scout-1"]
    assert "\x02digest\x03" in r["data"]["rows"][0]["snippet"].lower()
    assert r["data"]["fallback"] is None


def test_search_respects_filters(fx):
    assert ids(q(fx, "sessions_search", {"profiles": ["default"], "q": "digest"})) == []
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "hello", "source": "telegram"})) == ["s-default-1"]
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "hello", "sinceTs": fx.now - 100})) == []


def test_search_ignores_inactive_messages(fx):
    mf.add_message(fx.home / "state.db", "s-default-1", "assistant", "zebra stripes", fx.now - 1, active=0)
    mf.add_fts(fx.home / "state.db") if False else None
    sql(fx, "default", "INSERT INTO messages_fts(rowid, content) SELECT id, content FROM messages WHERE content = 'zebra stripes'")
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "zebra"})) == []


def test_search_text_is_never_sql_or_fts_syntax(fx):
    for hostile in ['" OR 1=1 --', "digest AND (", "NEAR(", "*", "a'b", "\\"]:
        r = q(fx, "sessions_search", {"profiles": [], "q": hostile})
        assert r["ok"] is True, hostile


def test_search_falls_back_to_titles_without_the_index(fx):
    sql(fx, "default", "DROP TABLE messages_fts")
    sql(fx, "scout", "DROP TABLE messages_fts")
    r = q(fx, "sessions_search", {"profiles": [], "q": "briefing"})
    assert ids(r) == ["s-default-1"] and r["data"]["fallback"] == "title"
    assert r["data"]["rows"][0]["snippet"] is None
    assert ids(q(fx, "sessions_search", {"profiles": [], "q": "100%"})) == []


def test_search_bad_args(fx):
    assert q(fx, "sessions_search", {"profiles": [], "q": ""})["error"] == "bad_args"
    assert q(fx, "sessions_search", {"profiles": [], "q": "x" * 201})["error"] == "bad_args"
    assert q(fx, "sessions_search", {"profiles": [], "q": 5})["error"] == "bad_args"
```

(Remove the no-op `mf.add_fts(...) if False else None` line when writing the file; it is shown only to stress that the index is updated by hand in that test.)

- [ ] **Step 2: Run to see failures**

Run: `python -m pytest tests/collector/test_sessions.py -q -k search`
Expected: FAIL (`unknown_command`).

- [ ] **Step 3: Implement.**

```python
SEARCH_QUERY_MAX = 200


def fts_expression(q):
    words = [w for w in q.split() if w]
    return " ".join('"%s"' % w.replace('"', '""') for w in words[:12])


def _like_pattern(q):
    esc = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return "%" + esc + "%"


def _has_table(con, name):
    return con.execute("SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table','view')", (name,)).fetchone() is not None


def _search_fts(con, scols, source, since, expr, limit):
    mcols = table_columns(con, "messages")
    where, params = ["messages_fts MATCH ?"], [expr]
    if "active" in mcols:
        where.append("m.active = 1")
    if since is not None:
        where.append("s.started_at >= ?")
        params.append(since)
    if source is not None and "source" in scols:
        where.append("s.source = ?")
        params.append(source)
    sql = ("SELECT m.session_id AS sid, snippet(messages_fts, -1, char(2), char(3), '...', 14) AS snip FROM messages_fts "
           "JOIN messages m ON m.id = messages_fts.rowid JOIN sessions s ON s.id = m.session_id "
           "WHERE %s ORDER BY rank LIMIT ?" % " AND ".join(where))
    return [(r[0], r[1]) for r in con.execute(sql, params + [limit])]


def _search_titles(con, scols, source, since, q, limit):
    if "title" not in scols:
        return []
    where, params = ["s.title LIKE ? ESCAPE '\\'"], [_like_pattern(q)]
    if since is not None:
        where.append("s.started_at >= ?")
        params.append(since)
    if source is not None and "source" in scols:
        where.append("s.source = ?")
        params.append(source)
    sql = "SELECT s.id FROM sessions s WHERE %s ORDER BY s.started_at DESC LIMIT ?" % " AND ".join(where)
    return [(r[0], None) for r in con.execute(sql, params + [limit])]


def q_sessions_search(home, a):
    profiles, source, since = _filters(a)
    q = a.get("q")
    if not isinstance(q, str) or not q.strip() or len(q) > SEARCH_QUERY_MAX:
        raise QueryError("bad_args")
    limit = _limit(a, SESSIONS_SEARCH_MAX, SESSIONS_SEARCH_MAX)
    expr = fts_expression(q)
    rows, errors, sources, readable, fallback = [], [], set(), 0, None
    for name, db in _each_profile(home, profiles):
        con = None
        try:
            con = open_ro(db)
            scols = table_columns(con, "sessions")
            try:
                _needs_sessions(scols)
            except QueryError:
                errors.append({"profile": name, "code": "unsupported_schema"})
                continue
            hits = None
            if _has_table(con, "messages_fts") and _has_table(con, "messages"):
                try:
                    hits = _search_fts(con, scols, source, since, expr, limit)
                except sqlite3.OperationalError:
                    hits = None
            if hits is None:
                fallback = "title"
                hits = _search_titles(con, scols, source, since, q, limit)
            snippets = {}
            for sid, snip in hits:
                snippets.setdefault(sid, snip)
            sids = list(snippets)
            for i in range(0, len(sids), 200):
                chunk = sids[i:i + 200]
                marks = ",".join("?" * len(chunk))
                got = _dict_rows(con.execute("SELECT %s FROM sessions s WHERE s.id IN (%s)" % (_session_select(scols), marks), chunk))
                kids = _children_of(con, scols, chunk)
                rows.extend(_session_row(name, g, g["id"] in kids, snippets.get(g["id"])) for g in got)
            if "source" in scols:
                sources.update(r[0] for r in con.execute("SELECT DISTINCT source FROM sessions WHERE source IS NOT NULL ORDER BY source LIMIT ?", (SESSIONS_SOURCES_MAX,)))
            readable += 1
        except sqlite3.Error:
            errors.append({"profile": name, "code": "db_unreadable"})
        finally:
            if con is not None:
                con.close()
    if errors and readable == 0:
        raise QueryError(errors[0]["code"])
    _sort_rows(rows)
    return {"rows": rows[:limit], "sources": sorted(sources)[:SESSIONS_SOURCES_MAX], "errors": errors, "more": len(rows) > limit, "fallback": fallback}
```

Register `"sessions_search": q_sessions_search`. If `char(2)` is not accepted by the SQLite build, use `X'02'`/`X'03'` blobs decoded in Python; verify with the test above before moving on.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/collector -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add collector tests/collector
git commit -m "feat(m8a): collector sessions_search over messages_fts with title fallback"
```

---

### Task 4: Collector `session_transcript`

**Files:**
- Modify: `collector/mc_collector.py`, `tests/collector/test_sessions.py`

**Interfaces:**
- Produces: `run_query(home, "session_transcript", {"profile", "sessionId", "afterId"?, "limit"?})` → `{"session": <SessionRow>, "items": [<FeedItem>], "nextAfter": int|None, "chain": {"parent": {id,title}|None, "children": [{id,title,source}]}, "total": int|None}`.

- [ ] **Step 1: Add failing tests**

```python
# ---- transcript -----------------------------------------------------------

def test_transcript_returns_items_session_and_chain(fx):
    r = q(fx, "session_transcript", {"profile": "scout", "sessionId": "s-scout-1"})
    assert r["ok"] is True
    d = r["data"]
    assert d["session"]["id"] == "s-scout-1" and d["session"]["title"] == "Digest run"
    assert [i["kind"] for i in d["items"]] == ["user", "thinking", "reply"]
    assert d["nextAfter"] is None and d["total"] == 2
    assert d["chain"]["parent"] is None
    assert [c["id"] for c in d["chain"]["children"]] == ["s-scout-child"]


def test_transcript_child_points_to_parent(fx):
    d = q(fx, "session_transcript", {"profile": "scout", "sessionId": "s-scout-child"})["data"]
    assert d["chain"]["parent"] == {"id": "s-scout-1", "title": "Digest run"}


def test_transcript_pages_by_message_id(fx):
    first = q(fx, "session_transcript", {"profile": "default", "sessionId": "s-default-1", "limit": 2})["data"]
    assert [i["messageId"] for i in first["items"]] == [2, 3, 3, 3][:len(first["items"])] or first["nextAfter"] is not None
    assert first["nextAfter"] is not None
    rest = q(fx, "session_transcript", {"profile": "default", "sessionId": "s-default-1", "afterId": first["nextAfter"], "limit": 200})["data"]
    seen = {i["id"] for i in first["items"]}
    assert not (seen & {i["id"] for i in rest["items"]})
    assert rest["nextAfter"] is None
    assert len(first["items"]) + len(rest["items"]) == 5  # user, thinking, reply, tool, result, reply minus the unnamed empty parts


def test_transcript_skips_inactive_messages(fx):
    mf.add_message(fx.home / "state.db", "s-default-1", "assistant", "hidden", fx.now, active=0)
    texts = [i["text"] for i in q(fx, "session_transcript", {"profile": "default", "sessionId": "s-default-1"})["data"]["items"]]
    assert "hidden" not in texts


def test_transcript_errors(fx):
    assert q(fx, "session_transcript", {"profile": "default", "sessionId": "nope"})["error"] == "not_found"
    assert q(fx, "session_transcript", {"profile": "ghost", "sessionId": "x"})["error"] == "not_found"
    assert q(fx, "session_transcript", {"profile": "../x", "sessionId": "x"})["error"] == "bad_args"
    assert q(fx, "session_transcript", {"profile": "default", "sessionId": "a b"})["error"] == "bad_args"
    assert q(fx, "session_transcript", {"profile": "default", "sessionId": "x", "afterId": -1})["error"] == "bad_args"
```

Before running, replace the two loose lines in `test_transcript_pages_by_message_id` with exact assertions after printing the real item list once: the session `s-default-1` has messages user, assistant(reasoning + tool call), tool, assistant, which `row_items` expands to `user`, `thinking`, `tool`, `result`, `reply` = 5 items from 4 messages (the assistant text "On it." is also an item, so 6). Pin the real numbers (`len(first) + len(rest)`) from the first green run and keep them as the assertion.

- [ ] **Step 2: Run to see failures**, `python -m pytest tests/collector/test_sessions.py -q -k transcript`. Expected: FAIL.

- [ ] **Step 3: Implement.**

```python
def q_session_transcript(home, a):
    name, sid = a.get("profile"), a.get("sessionId")
    if not valid_profile(name) or not isinstance(sid, str) or not ID_RE.match(sid):
        raise QueryError("bad_args")
    after = a.get("afterId", 0)
    if not valid_int(after, 0):
        raise QueryError("bad_args")
    limit = _limit(a, TRANSCRIPT_PAGE, TRANSCRIPT_PAGE)
    con = open_profile(home, name)
    try:
        parts = feed_select(con)
        scols = table_columns(con, "sessions")
        if parts is None or not {"id"} <= scols:
            raise QueryError("unsupported_schema")
        base, where = parts
        got = _dict_rows(con.execute("SELECT %s FROM sessions s WHERE s.id = ?" % _session_select(scols), (sid,)))
        rows = fetch_rows(con, base, where, ["m.session_id = ?", "m.id > ?"], [sid, after], "m.id ASC", limit)
        if not got and not rows:
            raise QueryError("not_found")
        srow = got[0] if got else {"id": sid}
        kids = _children_of(con, scols, [sid])
        parent = None
        pid = srow.get("parent_session_id")
        if pid and "title" in scols:
            prow = con.execute("SELECT title FROM sessions WHERE id = ?", (pid,)).fetchone()
            parent = {"id": pid, "title": _text(prow[0], 200) if prow else None}
        elif pid:
            parent = {"id": pid, "title": None}
        children = []
        if "parent_session_id" in scols:
            tcol = "title" if "title" in scols else "NULL"
            scol = "source" if "source" in scols else "NULL"
            children = [{"id": r[0], "title": _text(r[1], 200), "source": _text(r[2], 64)} for r in
                        con.execute("SELECT id, %s, %s FROM sessions WHERE parent_session_id = ? ORDER BY started_at LIMIT 50" % (tcol, scol), (sid,))]
    finally:
        con.close()
    items = []
    for r in rows:
        items.extend(row_items(name, r))
    ids_ = [r["id"] for r in rows if isinstance(r["id"], int)]
    return {
        "session": _session_row(name, srow, sid in kids),
        "items": items,
        "nextAfter": max(ids_) if len(rows) >= limit and ids_ else None,
        "chain": {"parent": parent, "children": children},
        "total": _opt_int(srow.get("message_count")),
    }
```

Register `"session_transcript": q_session_transcript`.

- [ ] **Step 4: Run the whole collector suite**: `python -m pytest tests/collector -q`. Expected: PASS. Also confirm the file is ASCII: `python -c "open('collector/mc_collector.py','rb').read().decode('ascii')"`.

- [ ] **Step 5: Commit**

```bash
git add collector tests/collector
git commit -m "feat(m8a): collector session_transcript with paging and parent/child chain"
```

---

### Task 5: Main wiring for the three queries

**Files:**
- Modify: `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/query.ts`, `src/main/ipc.ts`, `src/main/session.ts`
- Test: `tests/integration/sessions.test.ts`, `tests/unit/query.test.ts` (extend if it enumerates commands)

**Interfaces:**
- Consumes: Task 1 types, Task 2-4 collector commands.
- Produces: channels `sessionsList: 'mc:sessions:list'`, `sessionsSearch: 'mc:sessions:search'`, `sessionsTranscript: 'mc:sessions:transcript'`; `MissionApi.sessions.list(args: SessionsListArgs): Promise<QueryResult<SessionsList>>`, `.search(args: SessionsSearchArgs)`, `.transcript(args: TranscriptArgs): Promise<QueryResult<SessionTranscript>>`; `MissionSession.sessionsList/sessionsSearch/sessionsTranscript(args)`.

- [ ] **Step 1: Write the failing integration test** `tests/integration/sessions.test.ts`, copying the `setup()` helper of `tests/integration/feed.test.ts` (same imports, `secrets`, `script`, `startFakeSsh({ fixture: fx })`, a connected `MissionSession`). Use `await session.connect(req)` and wait until `session` is ready the same way `feed.test.ts` does before calling queries. Tests:

```ts
it('lists, searches and reads a transcript through the real collector', async () => {
  const { session } = await setup()
  const list = await session.sessionsList({ profiles: [], limit: 50 })
  expect(list.ok && list.data.rows.map((r) => r.id)).toEqual(['s-scout-child', 's-scout-1', 's-default-1', 's-default-old'])
  const found = await session.sessionsSearch({ profiles: [], q: 'digest', limit: 50 })
  expect(found.ok && found.data.rows[0]?.snippet).toContain('\u0002')
  const t = await session.sessionsTranscript({ profile: 'scout', sessionId: 's-scout-1', limit: 200 })
  expect(t.ok && t.data.chain.children.map((c) => c.id)).toEqual(['s-scout-child'])
})

it('changes nothing on the server (Zero-Change)', async () => {
  const before = snapshotTree(fx.root)
  const { session } = await setup()
  await session.sessionsList({ profiles: [], limit: 50 })
  await session.sessionsSearch({ profiles: [], q: 'hello', limit: 50 })
  await session.sessionsTranscript({ profile: 'default', sessionId: 's-default-1', limit: 200 })
  expect(snapshotTree(fx.root)).toEqual(before)
})
```

Match the connect/wait idiom and `snapshotTree` usage of the existing tests exactly (open `feed.test.ts` lines 60 onwards for it).

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- tests/integration/sessions.test.ts`
Expected: FAIL (`session.sessionsList is not a function`).

- [ ] **Step 3: Implement.**
  - `channels.ts`: add the three channels.
  - `query.ts`: extend `QueryCommand` with `'sessions_list' | 'sessions_search' | 'session_transcript'`.
  - `session.ts`: next to `feedSession`, add
    ```ts
    sessionsList(args: SessionsListArgs): Promise<QueryResult<SessionsList>> { return this.queries.run('sessions_list', args, SessionsList) }
    sessionsSearch(args: SessionsSearchArgs): Promise<QueryResult<SessionsList>> { return this.queries.run('sessions_search', args, SessionsList) }
    sessionsTranscript(args: TranscriptArgs): Promise<QueryResult<SessionTranscript>> { return this.queries.run('session_transcript', args, SessionTranscript) }
    ```
    with the imports from `@shared/events` and `@shared/sessions`.
  - `ipc.ts`: schemas and handlers.
    ```ts
    const SessionIdArg = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/)
    const SessionFilter = {
      profiles: z.array(ProfileName).max(50),
      source: z.string().min(1).max(64).optional(),
      sinceTs: z.number().finite().optional()
    }
    const SessionsListSchema = z.object({
      ...SessionFilter,
      before: z.object({ ts: z.number().finite().nullable(), id: SessionIdArg }).optional(),
      limit: z.number().int().min(1).max(100)
    })
    const SessionsSearchSchema = z.object({ ...SessionFilter, q: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(200) })
    const TranscriptSchema = z.object({ profile: ProfileName, sessionId: SessionIdArg, afterId: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200) })
    ```
    Handlers: `handle(IPC.sessionsList, (a) => d.session.sessionsList(SessionsListSchema.parse(a)))` and the two others. (Strip `undefined` optional keys is unnecessary: `JSON.stringify` drops them.)
  - `shared/ipc.ts`: add `sessions: { list(...), search(...), transcript(...) }` to `MissionApi` (import the types).
  - `preload/index.ts`: `sessions: { list: (a) => ipcRenderer.invoke(IPC.sessionsList, a), search: ..., transcript: ... }`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/integration/sessions.test.ts` then `npm run typecheck`
Expected: PASS and clean. If `tests/unit/query.test.ts` or a preload/API shape test lists commands or `MissionApi` keys, extend it.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(m8a): wire sessions queries through ipc, preload and MissionSession"
```

---

### Task 6: Session actions (pin, unpin, rename) and export writer

**Files:**
- Create: `src/main/sessions/actions.ts`, `src/main/sessions/export.ts`
- Modify: `src/main/session.ts`, `src/main/ipc.ts`, `src/shared/channels.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `tests/helpers/fakeHermes.ts`
- Test: `tests/integration/sessionActions.test.ts`, `tests/unit/sessionExportMain.test.ts`

**Interfaces:**
- Consumes: Task 1 (`sessionCommandArgs`, `validTitle`, `SessionActionResult`, `ExportExt`, `ExportResult`), `PROFILE_RE` from `@shared/agentCfg`.
- Produces: `class SessionActionService { constructor(d: { conn: Execer; hermes: () => { path: string } | null; isConnected: () => boolean; log?: (m: string) => void }); run(action: SessionAction, profile: string, sessionId: string, title?: string): Promise<SessionActionResult> }`; `saveExport(req: { name: string; ext: ExportExt; content: string }, win: BrowserWindow | null, dialogImpl?: SaveDialog): Promise<ExportResult>`; channels `sessionsAction: 'mc:sessions:action'`, `sessionsExport: 'mc:sessions:export'`; `MissionApi.sessions.action(req: { action: SessionAction; profile: string; sessionId: string; title?: string }): Promise<SessionActionResult>` and `.export(req: { name: string; ext: ExportExt; content: string }): Promise<ExportResult>`; fake `hermes [-p P] sessions pin|unpin|rename <id> [title]` recording into `FakeHermesState.sessionCalls: string[][]` (each call is the argv after `hermes`), failing when `failOn['sessions']` is set.

- [ ] **Step 1: Write failing tests.**
  - `tests/integration/sessionActions.test.ts` (same `setup()` idiom as other integration tests; read `tests/integration/agentModel.test.ts` for how `startFakeSsh().hermes` state is asserted): 
    ```ts
    it('pins, unpins and renames through the hermes CLI with each argument separate', async () => {
      const { session, srv } = await setup()
      expect(await session.sessionAction({ action: 'pin', profile: 'scout', sessionId: 's-scout-1' })).toEqual({ ok: true })
      expect(await session.sessionAction({ action: 'unpin', profile: 'default', sessionId: 's-default-1' })).toEqual({ ok: true })
      expect(await session.sessionAction({ action: 'rename', profile: 'scout', sessionId: 's-scout-1', title: 'a "b"; rm -rf /' })).toEqual({ ok: true })
      expect(srv.hermes.sessionCalls).toEqual([
        ['-p', 'scout', 'sessions', 'pin', 's-scout-1'],
        ['sessions', 'unpin', 's-default-1'],
        ['-p', 'scout', 'sessions', 'rename', 's-scout-1', 'a "b"; rm -rf /']
      ])
    })
    it('refuses bad input before running anything', async () => {
      const { session, srv } = await setup()
      expect(await session.sessionAction({ action: 'rename', profile: 'scout', sessionId: 's1', title: '  ' })).toMatchObject({ ok: false, error: 'bad-input' })
      expect(await session.sessionAction({ action: 'pin', profile: '../x', sessionId: 's1' })).toMatchObject({ ok: false, error: 'bad-input' })
      expect(srv.hermes.sessionCalls).toEqual([])
    })
    it('reports a CLI failure with its message', async () => {
      const { session, srv } = await setup()
      srv.hermes.failOn['sessions'] = 'no such session'
      expect(await session.sessionAction({ action: 'pin', profile: 'default', sessionId: 'zz' })).toEqual({ ok: false, error: 'failed', detail: 'no such session' })
    })
    ```
  - `tests/unit/sessionExportMain.test.ts`: `saveExport` with a fake dialog returning a temp path writes UTF-8 content and returns `{ saved }`; a canceled dialog returns `{ canceled: true }`; an extension outside `jsonl|md|html` and content over 50 MB return `{ failed }` without opening the dialog; the suggested file name is sanitized (`a/b:c` becomes `a_b_c.md`).

- [ ] **Step 2: Run to see failures**: `npm test -- tests/integration/sessionActions.test.ts tests/unit/sessionExportMain.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `src/main/sessions/actions.ts`:
    ```ts
    import { PROFILE_RE } from '@shared/agentCfg'
    import { sessionCommandArgs, validTitle, type SessionAction, type SessionActionResult } from '@shared/sessions'
    import type { Execer } from '../connection/manager'

    const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/

    export interface SessionActionDeps {
      conn: Execer
      hermes: () => { path: string } | null
      isConnected: () => boolean
      log?: (m: string) => void
    }

    /** Pin, unpin and rename: the only writes of the Sessions screen, always through the official CLI. */
    export class SessionActionService {
      constructor(private readonly d: SessionActionDeps) {}

      async run(action: SessionAction, profile: string, sessionId: string, title?: string): Promise<SessionActionResult> {
        if (!PROFILE_RE.test(profile) || !ID_RE.test(sessionId)) return { ok: false, error: 'bad-input' }
        let clean: string | undefined
        if (action === 'rename') {
          const t = validTitle(title ?? '')
          if (t === null) return { ok: false, error: 'bad-input' }
          clean = t
        }
        const h = this.d.hermes()
        if (!h || !this.d.isConnected()) return { ok: false, error: 'not-connected' }
        try {
          const r = await this.d.conn.exec([h.path, ...sessionCommandArgs(action, profile, sessionId, clean)], { timeoutMs: 20_000 })
          this.d.log?.(`session ${action} ${profile}/${sessionId} exit ${r.code}`)
          if (r.code === 0) return { ok: true }
          return { ok: false, error: 'failed', detail: (r.stderr.trim() || r.stdout.trim() || `exit code ${r.code}`).slice(0, 600) }
        } catch (e) {
          return { ok: false, error: 'failed', detail: (e instanceof Error ? e.message : String(e)).slice(0, 600) }
        }
      }
    }
    ```
  - `src/main/sessions/export.ts`:
    ```ts
    import { writeFile } from 'node:fs/promises'
    import { dialog, type BrowserWindow, type SaveDialogReturnValue } from 'electron'
    import type { ExportExt, ExportResult } from '@shared/sessions'

    export const EXPORT_MAX_BYTES = 50 * 1024 * 1024
    const EXTS: readonly ExportExt[] = ['jsonl', 'md', 'html']
    export type SaveDialog = (win: BrowserWindow | null, opts: { defaultPath: string; filters: { name: string; extensions: string[] }[] }) => Promise<SaveDialogReturnValue>

    const real: SaveDialog = (win, opts) => (win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts))

    export const safeName = (n: string): string => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'session'

    /** Writes an export the user asked for, to the path they pick. Nothing else is ever written. */
    export async function saveExport(req: { name: string; ext: ExportExt; content: string }, win: BrowserWindow | null, pick: SaveDialog = real): Promise<ExportResult> {
      if (!EXTS.includes(req.ext)) return { failed: 'Unsupported format.' }
      if (Buffer.byteLength(req.content, 'utf8') > EXPORT_MAX_BYTES) return { failed: 'The export is larger than 50 MB.' }
      const res = await pick(win, { defaultPath: `${safeName(req.name)}.${req.ext}`, filters: [{ name: req.ext.toUpperCase(), extensions: [req.ext] }] })
      if (res.canceled || !res.filePath) return { canceled: true }
      try {
        await writeFile(res.filePath, req.content, 'utf8')
        return { saved: res.filePath }
      } catch (e) {
        return { failed: e instanceof Error ? e.message : String(e) }
      }
    }
    ```
  - `session.ts`: construct `this.sessionActions = new SessionActionService({ conn: d.manager, hermes: () => (this.hermes ? { path: this.hermes.path } : null), isConnected: () => d.manager.isConnected(), log: (m) => d.log?.(m) })` next to the `ModelService` construction (copy how `hermes` is passed there), expose `sessionAction(req)` and `sessionExport(req, win)`; `ipc.ts` schemas `SessionActionSchema = z.object({ action: z.enum(['pin','unpin','rename']), profile: ProfileName, sessionId: SessionIdArg, title: z.string().max(200).optional() })` and `ExportSchema = z.object({ name: z.string().min(1).max(200), ext: z.enum(['jsonl','md','html']), content: z.string().max(EXPORT_MAX_BYTES) })`, handler passes `d.getWindow()`.
  - `fakeHermes.ts`: add `sessionCalls: string[][]` to the state (and `newHermesState`), and in `runConfigCommands` before the `config` check:
    ```ts
    if (tail[0] === 'sessions' && ['pin', 'unpin', 'rename'].includes(tail[1] ?? '')) {
      o.st.sessionCalls.push(rest)
      const fail = o.st.failOn['sessions']
      return reply(stream, fail ? '' : `OK ${tail[1]}\n`, fail ? 1 : 0, fail ? `${fail}\n` : ''), true
    }
    ```
    (write it as a normal `if` block returning `true`).

- [ ] **Step 4: Run tests and typecheck**: `npm test` (whole suite, because the fake changed) and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(m8a): pin, unpin, rename through the hermes CLI and a native-dialog export writer"
```

---

### Task 7: Pure renderer libs (query args, transcript pairing, export builders)

**Files:**
- Create: `src/renderer/lib/sessions.ts`, `src/renderer/lib/transcript.ts`, `src/renderer/lib/sessionExport.ts`
- Test: `tests/unit/sessionsLib.test.ts`, `tests/unit/transcriptLib.test.ts`, `tests/unit/sessionExport.test.ts`

**Interfaces:**
- Produces (`lib/sessions.ts`):
  - `interface SessionQuery { agent: string; range: Range; source: string; q: string }`, `DEFAULT_QUERY`.
  - `toArgs(q: SessionQuery, known: readonly string[], now: number): SessionFilterArgs` (agent `all` or a profile not in `known` gives `profiles: []`; source `all` gives none).
  - `rowKey(r: SessionRow): string` = `` `${r.profile}:${r.id}` ``.
  - `mergeFirstPage(current: SessionRow[], fresh: SessionRow[]): SessionRow[]`: replaces the head with `fresh`, keeps the rows of `current` older than the oldest `fresh` row (and not duplicated), sorted newest first.
  - `statusLabel(s: SessionStatus): string`, `costLabel(r: SessionRow): string` (`$1.82`, `$0.02 est.`, `—`), `durationLabel(r): string`.
  - `splitHighlight(snippet: string): { text: string; hit: boolean }[]` (splits on `\u0002`/`\u0003`).
  - `patchRow(rows, key, patch)`.
- Produces (`lib/transcript.ts`): `interface Step { kind: 'user' | 'reply' | 'thinking' | 'tool'; item: FeedItem; result?: FeedItem; ms?: number; failed?: boolean }` and `buildSteps(items: FeedItem[]): Step[]`, `looksFailed(text: string): boolean`.
- Produces (`lib/sessionExport.ts`): `toJsonl(row: SessionRow, items: FeedItem[]): string`, `toMarkdown(row, items): string`, `toHtml(row, items): string`, `exportName(row): string`.

- [ ] **Step 1: Write failing tests.** Key cases (write all as real Vitest `it` blocks with small literal fixtures built by a `item(partial)` helper in each test file):
  - `sessionsLib`: `toArgs` for `agent: 'scout'` known → `profiles: ['scout']`; unknown agent → `[]`; `range: '7d'` sets `sinceTs = now - 604800`; `source: 'all'` omitted. `mergeFirstPage`: fresh page replaces head rows with updated counts, keeps older loaded rows, no duplicates, order newest first; a row that vanished from the head range (started after the oldest fresh row) is dropped. `costLabel`: `0.5/actual → '$0.50'`, `0.02/estimated → '$0.02 est.'`, null → `'—'`, `0/actual → '$0.00'`. `splitHighlight('a \u0002bc\u0003 d')` → three parts with `hit` true for the middle one; text without markers → one part; unbalanced marker does not throw. `durationLabel`: `14m 08s`, `2h 05m`, running → `'running'`, unknown start → `'—'`.
  - `transcriptLib`: a `tool` item followed by a `result` with the same `toolName` becomes one step with `result` and `ms = round((result.ts - item.ts) * 1000)`; two calls of the same tool pair FIFO; a result with no call stays out of the steps (shown as `kind: 'tool'` with no `item`? **no**: it becomes a step of kind `tool` whose `item` is the result itself and `result` undefined, so nothing is lost; test that no item disappears: count of distinct item ids across steps equals input length); `looksFailed('Traceback (most recent call last)...')`, `'Error: ENOENT'`, `'{"error": "boom"}'`, `'exit code 1'` are true; `'3 results'`, `'no errors found'` are false (rule: starts, after trim and lowercase, with `error`, `traceback`, `exception`, `failed`, or contains `"error":` or `exit code` followed by a non-zero number).
  - `sessionExport`: `toJsonl` has one JSON object per line, the first line is the session header (`{"type":"session",...}`), each item line has `type: 'message'` plus kind, ts and text; `toMarkdown` has `# <title>`, a metadata list and `### user · <time>` style headings, tool items fenced; `toHtml` escapes `<script>alert(1)</script>` in titles and texts (`&lt;script&gt;`) and contains no raw `<script`; `exportName` is `<title-or-id>` sanitized without extension.

- [ ] **Step 2: Run to see failures**: `npm test -- tests/unit/sessionsLib.test.ts tests/unit/transcriptLib.test.ts tests/unit/sessionExport.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the three libs** to satisfy the interfaces above. Reference code for the two trickiest functions:

```ts
// lib/sessions.ts
export function mergeFirstPage(current: SessionRow[], fresh: SessionRow[]): SessionRow[] {
  if (fresh.length === 0) return current.length === 0 ? current : current
  const oldest = fresh.reduce((m, r) => Math.min(m, r.startedAt ?? -Infinity), Infinity)
  const keys = new Set(fresh.map(rowKey))
  const tail = current.filter((r) => !keys.has(rowKey(r)) && (r.startedAt ?? -Infinity) < oldest)
  return sortRows([...fresh, ...tail])
}
```
(The first `if` should simply `return current` when `fresh` is empty; refine while writing so the unit test "empty fresh page keeps current rows" passes.)

```ts
// lib/transcript.ts
export function buildSteps(items: FeedItem[]): Step[] {
  const steps: Step[] = []
  const open: Step[] = []
  for (const it of items) {
    if (it.kind === 'tool') {
      const s: Step = { kind: 'tool', item: it }
      steps.push(s)
      open.push(s)
    } else if (it.kind === 'result') {
      const i = open.findIndex((s) => (s.item.toolName ?? '') === (it.toolName ?? ''))
      if (i >= 0) {
        const s = open.splice(i, 1)[0]!
        s.result = it
        s.ms = Math.max(0, Math.round((it.ts - s.item.ts) * 1000))
        s.failed = looksFailed(it.text)
      } else steps.push({ kind: 'tool', item: it, failed: looksFailed(it.text) })
    } else steps.push({ kind: it.kind, item: it })
  }
  return steps
}
```
`toolName` of a `tool` item is the function name; a `result` item's `toolName` is `messages.tool_name`. They match in the fixture (`web_search`).

- [ ] **Step 4: Run tests + typecheck**: expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib tests/unit
git commit -m "feat(m8a): session query args, row merge, tool pairing and export builders"
```

---

### Task 8: Store and IO module

**Files:**
- Create: `src/renderer/stores/sessions.ts`, `src/renderer/sessionsActions.ts`
- Modify: `src/renderer/actions.ts` (reset the store on disconnect, next to the other `reset()` calls)
- Test: `tests/unit/sessionsStore.test.ts`

**Interfaces:**
- Consumes: Task 7 libs, `window.mc.sessions`, `saveSetting`, `resumeSession` (chatActions), `useAgents`, `useUi`.
- Produces (store `useSessions`): state `{ query: SessionQuery; rows: SessionRow[]; sources: string[]; more: boolean; fallback: 'title' | null; errors: {profile; code}[]; status: 'idle' | 'loading' | 'ok' | 'error'; error: string | null; receivedAt: number | null; loadingMore: boolean; selected: { profile: string; id: string } | null; transcript: TranscriptState }` with `TranscriptState = { status: 'idle' | 'loading' | 'ok' | 'error'; session: SessionRow | null; items: FeedItem[]; nextAfter: number | null; chain: SessionTranscript['chain'] | null; total: number | null; error: string | null; loadingMore: boolean }`, and reducers `setQuery(patch)`, `applyList(data, {append, replaceHead, now})`, `setStatus(...)`, `select(sel | null)`, `applyTranscript(data, append)`, `patchRow(key, patch)`, `reset()`.
- Produces (`sessionsActions.ts`): `loadList()`, `refreshList()`, `loadMore()`, `setQuery(patch)` (saves `filters.agent`/`filters.range` through `saveSetting`, debounces nothing; the screen debounces typing), `openSession(profile, id)`, `loadMoreTranscript()`, `runAction(action, row, title?)` (returns `SessionActionResult`, patches the row and refreshes on success), `exportSession(row, ext)` (reads all transcript pages up to 50, builds with `sessionExport`, calls `window.mc.sessions.export`, returns `ExportResult` plus a `truncated` boolean), `continueInChat(row)` (`useAgents.getState().select(profile)`, `await resumeSession(profile, id)`, `useUi.getState().navigate('chat')`), `queryErrorText(code)`.
- Stale answers: `loadList` keeps a module-level sequence number; an answer whose number is no longer current is dropped.

- [ ] **Step 1: Write failing tests** `tests/unit/sessionsStore.test.ts` for the pure store (no IPC): `applyList` replace vs append vs replaceHead (uses `mergeFirstPage`), `more`/`fallback`/`sources` stored, `setQuery` merges the patch, `select` clears the previous transcript, `applyTranscript` append concatenates items and updates `nextAfter`, `patchRow` changes pinned/title in place, `reset` returns the initial state. Plus a test file section that stubs `window.mc` (`globalThis.window = { mc: {...} }` as `chatStore.test.ts` does; read it first) to check `loadList` ignores a stale answer: start two loads, resolve the second first and then the first, assert the rows are the second's.

- [ ] **Step 2: Run to see failures.** Expected: FAIL.

- [ ] **Step 3: Implement** the store (zustand, same style as `stores/feed.ts`, with `EMPTY` and `reset`) and the actions. Rules the code must follow:
  - `loadList` builds args with `toArgs(query, knownProfiles, Date.now()/1000)`; empty `q` → `window.mc.sessions.list({...args, limit: 50})`, else `search({...args, q: query.q.trim(), limit: 200})`. Error mapping via the existing `lib/queryError.ts` (read it and reuse its text map; add `unsupported_schema` text "This Hermes version stores sessions in a layout this app does not know." if missing).
  - A failed refresh while rows exist sets `status: 'error'` but keeps `rows` and `receivedAt` (the screen shows the stale banner).
  - `refreshList` does nothing when `query.q !== ''` or `status === 'loading'`; it calls the list query for the first page only and applies it with `replaceHead`.
  - `loadMore` uses the last row as `before: { ts: last.startedAt, id: last.id }` (list mode only; search results have no paging).
  - The initial `query.agent`/`query.range` come from `useUi.getState().settings['filters.agent' | 'filters.range']` in `loadList` when the store is `idle`.
  - `exportSession` loops `window.mc.sessions.transcript({ profile, sessionId, afterId, limit: 200 })` until `nextAfter === null` or 50 pages.
  - Never log or toast message text.

- [ ] **Step 4: Run tests + typecheck.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/unit
git commit -m "feat(m8a): sessions store and IO actions with stale-answer protection"
```

---

### Task 9: Sessions screen: list, filters, states, refresh

**Files:**
- Create: `src/renderer/screens/Sessions.tsx`, `src/renderer/screens/sessions/SessionList.tsx`, `src/renderer/screens/sessions/SessionFilters.tsx`
- Modify: `src/renderer/App.tsx` (route `sessions` → `<Sessions />`), `src/renderer/screens/ComingSoon.tsx` (drop the `sessions` text), `src/renderer/styles/app.css` (classes prefixed `ses-`; copy tokens from the existing `f*` feed classes and the mockup `Sessions.dc.html` styles)
- Test: `tests/e2e/sessions.spec.ts` (first part, see Task 11), `tests/unit/sessionsView.test.tsx` only if the repo already tests React components (check `tests/unit` for `.test.tsx`; if none, cover through E2E)

**Interfaces:**
- Consumes: Task 8 store and actions, `useAgents`, `useNow`, `StaleBanner`, `Skeleton`, `EmptyState`, `ErrorState`, TanStack Virtual (see `screens/feed/FeedView.tsx` for the exact import and `useVirtualizer` usage).
- Produces: `<Sessions />` with a two-column layout (`ses-list` 380 px, `ses-detail` flexible; under 900 px width only one of them is visible, a Back button shows the list again), `<SessionList />`, `<SessionFilters />`; the right column renders `<Transcript />` from Task 10 (until then a placeholder `<EmptyState title="Select a session" />`).

Behavior to implement exactly:
- On mount: `loadList()`; interval 10 s calling `refreshList()` only while `document.visibilityState === 'visible'`; cleared on unmount.
- Filters row: agent chips (all agents from `useAgents`, a menu when more than 8, same look as `FeedFilters` `Chip`/`FilterMenu`; extract them to `components/FilterChips.tsx` and have `FeedFilters` import them to avoid duplicating), a Source `<select>` (`All sources` plus `sources`), a Range `<select>` (`Today`, `Last 7 days`, `Last 30 days`, `All time`) and a search input with `aria-label="Search sessions and messages"`, 250 ms debounce before `setQuery({ q })`.
- Row (fixed 64 px): title or `Untitled session`, second line agent dot + name + `source` chip + `N msgs · M tools`, third line snippet (search) with `<mark>` pieces from `splitHighlight` (never `dangerouslySetInnerHTML`), right side cost label, relative time (`formatAge` from `lib/format`), pinned flag icon, status chip (text label, not only color; `running` has the existing pulse class unless Reduce motion).
- List semantics: container `role="listbox"` `aria-label="Sessions"`, rows `role="option"` `aria-selected`, roving focus with ArrowUp/ArrowDown/Home/End, Enter or click selects (`openSession`).
- Footer row "Load more" button (`loadMore`) when `more && query.q === ''`; "Showing the best 200 matches" note when searching and `more`.
- Notices: `fallback === 'title'` → `Searching titles only: this database has no message index.`; each `errors[]` → `<profile>: state.db could not be read.` (one line each).
- States: `status === 'loading' && rows.length === 0` → `Skeleton rows={8}`; empty with no query/filter → `EmptyState title="No sessions yet" why="Sessions appear here as soon as an agent runs. Start one from Chat."`; empty with search → `No sessions match "<q>"` with button `Clear search and filters` (resets `q`, `source`, and sets agent/range to `all`); empty with only filters → `No sessions in this range` + same button; `status === 'error'` and no rows → `ErrorState title="Can't read the session history" why={error} onRetry={loadList}`; `status === 'error'` with rows → `StaleBanner label="Could not refresh sessions"` above the list.

- [ ] **Step 1:** Write the E2E skeleton assertions for this task in `tests/e2e/sessions.spec.ts` using `launchApp` and the fake SSH helpers exactly like `tests/e2e/feed.spec.ts` (read it first): connect, click the `Sessions` sidebar item, expect four options in `listbox "Sessions"`, expect the first to contain `Digest run`, type `digest` in the search box and expect one option with a `mark` element containing `digest`, select range `Today` and agent chip `Scout`.
- [ ] **Step 2:** Run `npm run test:e2e -- tests/e2e/sessions.spec.ts` and see it fail (route still shows Coming soon).
- [ ] **Step 3:** Implement the files above and the CSS.
- [ ] **Step 4:** Run the E2E again: PASS; run `npm run typecheck` and `npm test`.
- [ ] **Step 5: Commit** `feat(m8a): sessions screen with list, filters, search and states`.

---

### Task 10: Transcript panel and actions

**Files:**
- Create: `src/renderer/screens/sessions/Transcript.tsx`, `src/renderer/screens/sessions/ToolChip.tsx`, `src/renderer/screens/sessions/ActionDialogs.tsx`
- Modify: `src/renderer/screens/Sessions.tsx` (render `<Transcript />`), `src/renderer/styles/app.css`
- Test: extend `tests/e2e/sessions.spec.ts`

**Interfaces:**
- Consumes: Task 7 `buildSteps`, Task 8 store/actions, `Markdown` component (`components/Markdown.tsx`, used by chat for replies), `Modal` (`components/Modal.tsx`), `sessionCommandPreview`, `validTitle`, `TITLE_MAX`.
- Produces: `<Transcript />` reading `useSessions`; `<ToolChip step />`; `<PinDialog />`/`<RenameDialog />` (or one `ActionDialog` with a `mode` prop).

Behavior to implement exactly:
- Header: title (or `Untitled session`), session id (selectable text), agent, source, model, status chip, duration, tokens (`in / out / cache`), cost label; chain lines `continues <button>` (parent title or id) and `continued in <button>` per child, each calling `openSession(row.profile, id)`; actions row: **Continue in Chat** (primary, `title` attribute showing the `hermes ... chat --resume` text), **Pin**/**Unpin** (`aria-pressed`), **Rename**, **Export** menu (`role="menu"` with Markdown, HTML, JSONL items).
- Body: `buildSteps(items)` rendered in order. `user` → right-aligned bubble; `reply` → `Markdown`; `thinking` → collapsed `<details>` labelled `Thinking`; `tool` → `ToolChip`: collapsed line `tool_name · short args · 240 ms` with a red `failed?` label when `step.failed` (`title="Detected from the result text; may be wrong"`), expand shows `Input` and `Output` `<pre>` blocks (capped at 4,000 characters with the existing "Show full" behavior from `FeedRow` reused only if `truncated`; otherwise show what was received).
- Footer: if `nextAfter !== null` a **Load next 200** button (`loadMoreTranscript`), and a counter `<shown> of <total> messages` when `total` is known.
- States: `loading` → skeleton; `error` → `ErrorState` with Retry (`openSession` again); empty items → `EmptyState title="No messages in this session"`.
- Pin/Unpin: click opens the confirm dialog with the preview line from `sessionCommandPreview`, buttons `Cancel` / `Pin session`; Rename: input (maxLength 80, label `New title`, prefilled with the current title), live preview, confirm disabled when `validTitle` is null. On `{ ok: false }` show `detail` inside the dialog and keep it open; on success close it and toast `Session pinned` / `Session unpinned` / `Session renamed` using the existing notification helper (find it with `Grep` for `notify(` in `actions.ts`).
- Export: toast `Saved to <path>. Built on this computer, nothing was written on the server.`; truncated exports add `Exported the first 10,000 messages.`; canceled does nothing; failed shows the message in an error toast.
- Continue in Chat: calls `continueInChat(row)`.

- [ ] **Step 1:** Extend the E2E with: click `Digest run`, expect the header, a `Thinking` details element, the child link `continued in`, click it and expect the child session header and a `continues` link; open the chip of `default` session `Morning briefing` and see `web_search`; Pin → dialog shows `$ hermes sessions pin s-default-1` → confirm → row shows the pinned flag after refresh (the fake `hermes` records the call; assert through the fake SSH state if the e2e helper exposes it, otherwise assert the success toast); Rename with an invalid title keeps Confirm disabled; Export → stub `dialog.showSaveDialog` in the Electron main through `electronApp.evaluate` to return a temp path, then assert the file exists and holds the title; Continue in Chat → the Chat screen is shown with the `Morning briefing` conversation.
- [ ] **Step 2:** Run it and see it fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run test:e2e -- tests/e2e/sessions.spec.ts`, `npm test`, `npm run typecheck`. PASS.
- [ ] **Step 5: Commit** `feat(m8a): transcript panel with tool chips, chain links, actions and export`.

---

### Task 11: Zero-Change e2e, accessibility and visual pass

**Files:**
- Modify: `tests/e2e/sessions.spec.ts`, `tests/e2e/visual.spec.ts` (add a Sessions screenshot only if that spec already screenshots other screens; follow its pattern)

- [ ] **Step 1:** Add an E2E test "browsing sessions changes nothing on the server": snapshot the fixture tree before (use the helper the other Zero-Change E2E tests use, e.g. in `tests/e2e/feed.spec.ts` or `app.spec.ts`; search with `Grep` for `snapshotTree`), open Sessions, search, open two transcripts, load more; compare the snapshot after (pin/rename/export not used).
- [ ] **Step 2:** Add keyboard/a11y checks: ArrowDown moves `aria-selected`, Enter opens, the search input has an accessible name, the status chips contain text.
- [ ] **Step 3:** Use the `run`/preview flow: `npm run dev:fake` plus `npm run dev` (or the e2e shots) and take a screenshot of the Sessions screen with data; check the layout at 900 px and 1280 px widths for overflow and the clipped-title problem described in CLAUDE.md for panels; fix CSS if needed.
- [ ] **Step 4:** Run `npm run test:e2e` (whole suite) and `npm test`, `npm run test:py`, `npm run typecheck`. All green.
- [ ] **Step 5: Commit** `test(m8a): zero-change, keyboard and layout checks for Sessions`.

---

### Task 12: Docs, checklist and final verification

**Files:**
- Modify: `docs/manual-vps-checklist.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-13-m8a-sessions-design.md`

- [ ] **Step 1:** Spec fixes to match the build: range values are `today | 7d | 30d | all` everywhere (spec text says `24h`; fix the Decisions, Main process and Renderer sections), and search results are ordered newest first after taking the best 200 hits by rank per profile.
- [ ] **Step 2:** Checklist: add steps 78 and up (read the last steps of `docs/manual-vps-checklist.md` to continue the numbering and match the style): (78) the Sessions list shows real sessions of every profile with right counts and costs; (79) `messages_fts` shape: search for a word and get a snippet, and note the table definition (`sqlite3 state.db ".schema messages_fts"`, read only); no results means the fallback note appears, record why; (80) `cost_status` and `end_reason` values seen in real data and whether the status chips are right; (81) `hermes sessions pin|unpin|rename` syntax and exit codes on the real CLI, including a title with quotes; (82) Continue in Chat resumes that session; (83) search speed on the largest `state.db` (note the time for a common word); (84) Export files open correctly and nothing new appears on the VPS.
- [ ] **Step 3:** `CLAUDE.md`: change the project-state sentence to list M8a (sessions) as built and M8b/M8c, M9, M10 as not built; add a "Sessions (M8a)" paragraph in the style of the others (queries `sessions_list/search/transcript` in the collector and their error codes, `SessionActionService` and `saveExport` in `src/main/sessions/`, `filters.agent`/`filters.range` settings, renderer files, unverified assumptions: FTS shape, `cost_status`, `end_reason`, CLI syntax; checklist steps 78-84; spec path).
- [ ] **Step 4: Final verification (superpowers:verification-before-completion):** run `npm run typecheck`, `npm test`, `npm run test:py`, `npm run test:e2e`, `npm run build`; read the outputs and report real numbers. Then use superpowers:finishing-a-development-branch to present the integration options.
- [ ] **Step 5: Commit** `docs(m8a): checklist steps 78-84, CLAUDE.md paragraph and spec alignment`.

---

## Self-Review

**Spec coverage:** list (T2, T9), search with FTS and fallback (T3, T9), transcript, paging and chain (T4, T10), tool chips and failed guess (T7, T10), actions Continue/Pin/Rename (T6, T10), local export (T6, T7, T10), shared filters F-NAV-8 (T1, T8, T9), states F-SESS-6 (T9, T10), performance F-SESS-7 (virtualized list T9, 200 message pages T4), Zero-Change tests (T5, T11), checklist and docs (T12). Not covered on purpose: palette and badges (M8c), Usage (M8b).

**Type consistency:** `SessionRow`, `SessionsList`, `SessionTranscript` (T1) are what T2-T4 emit and T5/T8 consume; `SessionFilterArgs/ListArgs/SearchArgs/TranscriptArgs` (T1) match the collector args and the zod schemas in T5; `SessionAction`, `SessionActionResult`, `ExportExt`, `ExportResult` (T1) are used in T6 and T8; store and action names in T8 are the ones T9 and T10 call.

**Known judgment calls to confirm while building:** `char(2)` in the FTS snippet call (T3 step 3 has the fallback), the exact item counts in the paging test (T4 step 1 says to pin them from the first green run), and the e2e helper for asserting fake `hermes` calls (T10 step 1).
