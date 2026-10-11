import json
import os
import stat as statmod
import sys
from pathlib import Path

import pytest

import make_fixture as mf
import mc_collector as c


def q(fx, cmd, args):
    return c.run_query(str(fx.home), cmd, json.dumps(args))


def app_session(fx, sid, ts, text, profile_db=None):
    db = profile_db or fx.home / "state.db"
    mf.add_session(db, sid, "mission-control", ts)
    mf.add_message(db, sid, "user", text, ts + 1)
    mf.add_message(db, sid, "assistant", "ok", ts + 2)


# ---- chat_sessions --------------------------------------------------------

def test_lists_only_sessions_started_by_the_app_newest_first(fx):
    app_session(fx, "s-app-old", fx.now - 5000, "first question about the roadmap")
    app_session(fx, "s-app-new", fx.now - 100, "second question")
    r = q(fx, "chat_sessions", {"profile": "default"})
    assert r["ok"]
    ids = [s["id"] for s in r["data"]["sessions"]]
    assert ids == ["s-app-new", "s-app-old"]  # telegram sessions of the fixture are left out
    new = r["data"]["sessions"][0]
    assert new["preview"] == "second question" and new["messages"] == 2
    assert new["startedAt"] == pytest.approx(fx.now - 100, abs=1)


def test_any_source_also_lists_sessions_of_other_sources(fx):
    app_session(fx, "s-app", fx.now - 100, "from the app")
    ids = [s["id"] for s in q(fx, "chat_sessions", {"profile": "default", "any": True})["data"]["sessions"]]
    assert "s-app" in ids and len(ids) > 1  # the fixture's own telegram sessions are included


def test_preview_is_cut_and_other_profiles_are_separate(fx):
    app_session(fx, "s-long", fx.now - 10, "x" * 300)
    r = q(fx, "chat_sessions", {"profile": "default"})
    assert len(r["data"]["sessions"][0]["preview"]) <= 80
    assert q(fx, "chat_sessions", {"profile": "scout"})["data"]["sessions"] == []


def test_chat_sessions_validates_and_reports_missing_profiles(fx):
    assert q(fx, "chat_sessions", {"profile": "../x"})["error"] == "bad_args"
    assert q(fx, "chat_sessions", {})["error"] == "bad_args"
    assert q(fx, "chat_sessions", {"profile": "ghost"})["error"] == "not_found"


def test_chat_sessions_writes_nothing(fx):
    app_session(fx, "s-app", fx.now - 10, "hello")
    before = mf.snapshot(fx.root)
    q(fx, "chat_sessions", {"profile": "default"})
    assert mf.snapshot(fx.root) == before


# ---- uploads_list ---------------------------------------------------------

def make_uploads(root):
    mf.w(root / "atlas" / "20261010" / "report.pdf", "pdf bytes")
    mf.w(root / "atlas" / "20261011" / "notes.txt", "notes")
    mf.w(root / "scout" / "20261011" / "pic.png", "png")
    mf.w(root / ".hidden" / "20261011" / "no.txt", "x")
    mf.w(root / "loose.txt", "not in an agent folder")
    return root


def test_lists_uploads_by_agent_and_date(tmp_path):
    root = make_uploads(tmp_path / "hermes-uploads")
    r = c.run_query("/unused", "uploads_list", json.dumps({"dir": str(root)}))
    assert r["ok"]
    files = r["data"]["files"]
    assert [(f["agent"], f["date"], f["name"]) for f in files] == [
        ("atlas", "20261010", "report.pdf"),
        ("atlas", "20261011", "notes.txt"),
        ("scout", "20261011", "pic.png"),
    ]
    assert files[0]["size"] == len("pdf bytes") and files[0]["path"].endswith("report.pdf")
    assert r["data"]["exists"] is True and r["data"]["truncated"] is False


def test_a_missing_uploads_folder_is_empty_not_an_error(tmp_path):
    r = c.run_query("/unused", "uploads_list", json.dumps({"dir": str(tmp_path / "nope")}))
    assert r["ok"] and r["data"]["files"] == [] and r["data"]["exists"] is False
    assert c.run_query("/unused", "uploads_list", json.dumps({}))["error"] == "bad_args"


def test_uploads_list_is_capped_and_does_not_follow_links(tmp_path):
    root = tmp_path / "up"
    for i in range(c.UPLOADS_MAX + 5):
        mf.w(root / "a" / "20261010" / f"f{i:04}.txt", "x")
    r = c.run_query("/unused", "uploads_list", json.dumps({"dir": str(root)}))
    assert len(r["data"]["files"]) == c.UPLOADS_MAX and r["data"]["truncated"] is True
    outside = tmp_path / "outside"
    mf.w(outside / "secret.txt", "s")
    link_root = tmp_path / "links"
    mf.w(link_root / "agent" / "20261010" / "real.txt", "r")
    try:
        os.symlink(outside, link_root / "evil", target_is_directory=True)
        os.symlink(outside / "secret.txt", link_root / "agent" / "20261010" / "link.txt")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not available")
    names = [f["name"] for f in c.run_query("/unused", "uploads_list", json.dumps({"dir": str(link_root)}))["data"]["files"]]
    assert names == ["real.txt"]


def test_uploads_list_writes_nothing(tmp_path):
    root = make_uploads(tmp_path / "hermes-uploads")
    before = mf.snapshot(tmp_path)
    c.run_query("/unused", "uploads_list", json.dumps({"dir": str(root)}))
    assert mf.snapshot(tmp_path) == before
