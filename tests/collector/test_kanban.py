import json
import sqlite3

import make_fixture as mf
import mc_collector as c


def q(fx, cmd, args):
    return c.run_query(str(fx.home), cmd, json.dumps(args))


def boards(fx):
    return q(fx, "kanban_boards", {})


def tasks(fx, board="sim-kanban"):
    return q(fx, "kanban_tasks", {"board": board})


def detail(fx, tid, board="sim-kanban"):
    return q(fx, "kanban_task", {"board": board, "id": tid})


# ---- boards -----------------------------------------------------------------

def test_boards_list_the_home_board_and_the_board_folders_with_their_counts(fx):
    mf.add_real_kanban(fx)
    r = boards(fx)
    assert r["ok"] is True
    by = {b["slug"]: b for b in r["data"]["boards"]}
    assert list(by) == ["default", "sim-kanban"]
    assert by["default"]["tasks"] == 0 and by["default"]["readable"] is True and by["default"]["path"] == "kanban.db"
    sim = by["sim-kanban"]
    assert sim["path"] == "kanban/boards/sim-kanban/kanban.db"
    assert sim["tasks"] == 8 and sim["archived"] == 1
    assert sim["byStatus"]["running"] == 1 and sim["byStatus"]["done"] == 1 and sim["byStatus"]["weird"] == 1


def test_a_missing_database_is_not_listed_and_an_unreadable_one_is_reported(fx):
    mf.add_real_kanban(fx)
    (fx.home / "kanban" / "boards" / "empty-folder").mkdir(parents=True)
    bad = fx.home / "kanban" / "boards" / "bad"
    bad.mkdir(parents=True)
    (bad / "kanban.db").write_bytes(b"not a database")
    r = boards(fx)["data"]
    assert [b["slug"] for b in r["boards"] if b["readable"]] == ["default", "sim-kanban"]
    assert "empty-folder" not in [b["slug"] for b in r["boards"]]
    assert {"slug": "bad", "code": "db_unreadable"} in r["errors"]


def test_no_boards_at_all(fx):
    assert boards(fx)["data"] == {"boards": [], "errors": []}


# ---- tasks ------------------------------------------------------------------

def test_tasks_of_a_board_with_counts_and_the_fields_of_a_card(fx):
    mf.add_real_kanban(fx)
    d = tasks(fx)["data"]
    assert d["board"] == "sim-kanban" and d["archived"] == 1 and d["truncated"] is False
    by = {t["id"]: t for t in d["tasks"]}
    assert set(by) == {"t_done1", "t_run1", "t_blk1", "t_rev1", "t_todo1", "t_tri1", "t_sch1", "t_odd1"}
    run = by["t_run1"]
    assert run["title"] == "Draft the weekly digest" and run["assignee"] == "scout" and run["createdBy"] == "atlas" and run["status"] == "running"
    assert run["comments"] == 2 and run["parents"] == 1 and run["children"] == 1 and run["priority"] == 1
    assert run["startedAt"] is not None and run["completedAt"] is None and run["failed"] is False
    blk = by["t_blk1"]
    assert blk["failed"] is True and blk["failures"] == 2 and blk["blockKind"] == "human" and blk["priority"] == 2
    assert by["t_odd1"]["status"] == "weird" and by["t_todo1"]["assignee"] is None
    assert [t["id"] for t in d["tasks"]][0] == "t_odd1"  # newest first


def test_a_big_board_is_cut_and_says_so(fx):
    mf.add_real_kanban(fx)
    con = sqlite3.connect(fx.home / "kanban" / "boards" / "sim-kanban" / "kanban.db")
    for i in range(1005):
        con.execute("INSERT INTO tasks (id, title, status, created_at, priority) VALUES (?, 'x', 'todo', ?, 0)", (f"bulk{i}", 10 + i))
    con.commit()
    con.close()
    d = tasks(fx)["data"]
    assert d["truncated"] is True and len(d["tasks"]) == 1000


def test_a_board_with_fewer_tables_and_columns_still_lists_its_tasks(fx):
    path = fx.home / "kanban" / "boards" / "lean" / "kanban.db"
    path.parent.mkdir(parents=True)
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE tasks (id TEXT, title TEXT, status TEXT)")
    con.execute("INSERT INTO tasks VALUES ('a', 'Only a title', 'todo')")
    con.commit()
    con.close()
    t = tasks(fx, "lean")["data"]["tasks"][0]
    assert t["id"] == "a" and t["assignee"] is None and t["comments"] == 0 and t["parents"] == 0 and t["priority"] == 0 and t["createdAt"] is None


def test_task_list_errors(fx):
    mf.add_real_kanban(fx)
    assert tasks(fx, "../x")["error"] == "bad_args"
    assert q(fx, "kanban_tasks", {})["error"] == "bad_args"
    assert tasks(fx, "ghost")["error"] == "not_found"


# ---- one task ---------------------------------------------------------------

def test_one_task_with_comments_runs_links_events_and_attachments(fx):
    mf.add_real_kanban(fx)
    d = detail(fx, "t_run1")["data"]
    t = d["task"]
    assert t["body"] == "Draft the digest from **3 notes**." and t["sessionId"] == "s-scout-1" and t["skills"] == "web,notes" and t["modelOverride"] == "m-x"
    assert [(x["author"], x["body"]) for x in d["comments"]] == [("atlas", "Please keep it under 120 words."), ("scout", "On it.")]
    assert [(r["profile"], r["status"]) for r in d["runs"]] == [("scout", "running")]
    assert d["parents"] == [{"id": "t_done1", "title": "Find sources for the changelog", "status": "done"}]
    assert d["children"] == [{"id": "t_blk1", "title": "Fix inbox-triage delivery", "status": "blocked"}]
    assert [e["kind"] for e in d["events"]] == ["created", "claimed", "heartbeat"]
    assert d["events"][0]["payload"] == '{"by": "atlas"}' and d["events"][2]["payload"] is None
    assert d["attachments"] == [{"id": 1, "filename": "notes.txt", "size": 2048, "uploadedBy": "atlas", "createdAt": d["attachments"][0]["createdAt"]}]


def test_a_finished_task_shows_its_run_and_result(fx):
    mf.add_real_kanban(fx)
    d = detail(fx, "t_done1")["data"]
    assert d["task"]["result"] == "6 sources" and d["task"]["completedAt"] is not None
    assert d["runs"][0]["outcome"] == "completed" and d["runs"][0]["summary"] == "6 sources found" and d["runs"][0]["endedAt"] is not None


def test_long_texts_are_cut(fx):
    mf.add_real_kanban(fx)
    con = sqlite3.connect(fx.home / "kanban" / "boards" / "sim-kanban" / "kanban.db")
    con.execute("UPDATE tasks SET body = ? WHERE id = 't_todo1'", ("b" * 70000,))
    con.execute("INSERT INTO task_comments (task_id, author, body, created_at) VALUES ('t_todo1', 'x', ?, 1)", ("c" * 20000,))
    con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t_todo1', 'k', ?, 1)", ("p" * 5000,))
    con.commit()
    con.close()
    d = detail(fx, "t_todo1")["data"]
    assert len(d["task"]["body"]) == 65536 and len(d["comments"][0]["body"]) == 16384 and len(d["events"][0]["payload"]) == 2000


def test_only_the_latest_hundred_events_come_back_oldest_first(fx):
    mf.add_real_kanban(fx)
    con = sqlite3.connect(fx.home / "kanban" / "boards" / "sim-kanban" / "kanban.db")
    for i in range(150):
        con.execute("INSERT INTO task_events (task_id, kind, payload, created_at) VALUES ('t_todo1', ?, NULL, ?)", (f"e{i}", 1000 + i))
    con.commit()
    con.close()
    ev = detail(fx, "t_todo1")["data"]["events"]
    assert len(ev) == 100 and ev[0]["kind"] == "e50" and ev[-1]["kind"] == "e149"


def test_task_errors(fx):
    mf.add_real_kanban(fx)
    assert detail(fx, "nope")["error"] == "not_found"
    assert detail(fx, "a b")["error"] == "bad_args"
    assert detail(fx, "t_run1", "../x")["error"] == "bad_args"
    assert detail(fx, "t_run1", "ghost")["error"] == "not_found"
    assert q(fx, "kanban_task", {"board": "sim-kanban"})["error"] == "bad_args"


def test_the_answer_for_a_task_with_huge_comments_stays_under_the_output_limit(fx):
    mf.add_real_kanban(fx)
    con = sqlite3.connect(fx.home / "kanban" / "boards" / "sim-kanban" / "kanban.db")
    for i in range(200):
        con.execute("INSERT INTO task_comments (task_id, author, body, created_at) VALUES ('t_todo1', 'x', ?, ?)", ("c" * 20000, i))
    con.commit()
    con.close()
    out = c.run_query(str(fx.home), "kanban_task", json.dumps({"board": "sim-kanban", "id": "t_todo1"}))
    assert len(json.dumps(out)) < 900_000
    assert 0 < len(out["data"]["comments"]) < 200
