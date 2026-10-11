import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "collector" / "mc_collector.py"


def q(cmd, args):
    return c.run_query("/unused", cmd, json.dumps(args))


def vault(tmp_path, notes):
    for rel, text in notes.items():
        mf.w(tmp_path / rel, text)
    return tmp_path


# ---- parser ---------------------------------------------------------------

def test_wikilink_forms():
    p = c.parse_note("[[A]] [[B|alias]] [[C#Heading]] [[D^block]] ![[E]] [[folder/F]] [[G.md]] [[#only-heading]]")
    assert p["links"] == ["A", "B", "C", "D", "E", "folder/F", "G"]


def test_markdown_links_count_only_local_targets():
    p = c.parse_note("[a](Local.md) [b](https://x.org/y.md) [c](#h) [d](<My Note.md>) [e](Other%20Note.md) [f](mailto:a@b.c) ![i](pic.png)")
    assert p["links"] == ["Local", "My Note", "Other Note", "pic.png"]


def test_links_and_tags_inside_code_are_ignored():
    p = c.parse_note("real [[A]] #real\n```\n[[B]] #fenced\n```\n~~~\n[[C]]\n~~~\ninline `[[D]] #inline` done")
    assert p["links"] == ["A"]
    assert p["tags"] == ["real"]


def test_tags_rules():
    p = c.parse_note("# Heading\ntext #one #two/three, (#paren) issue #123 and a#notatag #Mixed_case-1")
    assert p["tags"] == ["one", "two/three", "paren", "Mixed_case-1"]


def test_frontmatter_tags_and_aliases_in_every_form():
    inline = c.parse_note("---\ntags: [a, '#b', \"c\"]\naliases: [X, Y]\n---\nbody #body")
    assert inline["tags"] == ["a", "b", "c", "body"] and inline["aliases"] == ["X", "Y"]
    block = c.parse_note("---\ntags:\n  - one\n  - two\nalias:\n  - Z\nother: 1\n---\n")
    assert block["tags"] == ["one", "two"] and block["aliases"] == ["Z"]
    plain = c.parse_note("---\ntags: red, green\naliases: Solo\n---\n")
    assert plain["tags"] == ["red", "green"] and plain["aliases"] == ["Solo"]
    spaced = c.parse_note("---\ntags: red green\n---\n")
    assert spaced["tags"] == ["red", "green"]


def test_frontmatter_must_open_the_file():
    p = c.parse_note("intro\n---\ntags: [no]\n---\n[[A]]")
    assert p["tags"] == [] and p["links"] == ["A"]
    assert c.parse_note("---\ntags: [x]\nnever closed")["tags"] == []


# ---- resolution -----------------------------------------------------------

def notes_of(tmp_path, files):
    vault(tmp_path, files)
    return {n["id"]: n for n in c.VaultState(str(tmp_path)).snapshot()}


def test_resolution_is_case_insensitive_and_follows_aliases(tmp_path):
    n = notes_of(tmp_path, {"Alpha.md": "---\naliases: [First]\n---\n", "b.md": "[[ALPHA]] [[first]] [[alpha.MD]]"})
    assert n["b.md"]["links"] == ["Alpha.md"]


def test_the_shortest_path_wins_and_paths_match_by_suffix(tmp_path):
    n = notes_of(tmp_path, {
        "x/deep/Note.md": "",
        "Note.md": "",
        "other/Note.md": "",
        "ref.md": "[[Note]] [[deep/Note]] [[x/deep/Note]] [[nope/Note]]",
    })
    assert n["ref.md"]["links"] == ["Note.md", "x/deep/Note.md"]
    assert n["ref.md"]["ghosts"] == ["nope/Note"]


def test_ghosts_attachments_and_self_links(tmp_path):
    n = notes_of(tmp_path, {"a.md": "[[a]] [[Missing]] [[missing]] ![[pic.PNG]] ![[docs/file.pdf]] [[v1.2 plan]]"})
    a = n["a.md"]
    assert a["links"] == []
    assert a["ghosts"] == ["Missing", "v1.2 plan"]
    assert a["attachments"] == ["file.pdf", "pic.PNG"]


def test_hidden_folders_and_other_files_are_skipped(tmp_path):
    n = notes_of(tmp_path, {"keep.md": "", ".obsidian/x.md": "", ".git/y.md": "", ".trash/z.md": "", "sub/.hidden/q.md": "", "note.txt": "", "Upper.MD": ""})
    assert sorted(n) == ["Upper.MD", "keep.md"]


def test_symlinked_notes_are_not_followed(tmp_path):
    outside = tmp_path / "outside"
    mf.w(outside / "secret.md", "[[X]]")
    v = tmp_path / "v"
    mf.w(v / "a.md", "")
    try:
        os.symlink(outside / "secret.md", v / "link.md")
        os.symlink(outside, v / "dirlink")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not available")
    assert sorted(x["id"] for x in c.VaultState(str(v)).snapshot()) == ["a.md"]


def test_limits(tmp_path):
    vault(tmp_path, {f"n{i}.md": "" for i in range(12)})
    st = c.VaultState(str(tmp_path), limit=5)
    assert len(st.snapshot()) == 5 and st.truncated is True
    mf.w(tmp_path / "big.md", "x" * (c.VAULT_BIG_FILE + 10) + "[[n1]]")
    big = {n["id"]: n for n in c.VaultState(str(tmp_path)).snapshot()}["big.md"]
    assert big["links"] == [] and big["size"] > c.VAULT_BIG_FILE


# ---- snapshot and delta ---------------------------------------------------

def test_the_fixture_vault_matches_the_expected_graph(fx):
    n = {x["id"]: x for x in c.VaultState(str(fx.vault)).snapshot()}
    assert sorted(n) == ["Alpha.md", "Beta.md", "Index.md", "Orphan.md", "folder/Alpha.md", "folder/Gamma.md"]
    assert n["Index.md"]["links"] == ["Alpha.md", "Beta.md", "folder/Gamma.md"]
    assert n["Index.md"]["ghosts"] == ["Missing Note"] and n["Index.md"]["attachments"] == ["diagram.png"]
    assert n["Index.md"]["tags"] == ["home", "hub", "project/x", "idea"]
    assert n["Beta.md"]["links"] == ["Alpha.md", "Orphan.md"]
    assert n["Alpha.md"]["aliases"] == ["A", "First"] and n["Alpha.md"]["tags"] == ["alpha", "work"]
    assert n["folder/Gamma.md"]["tags"] == ["nested/tag"] and n["folder/Gamma.md"]["links"] == ["Index.md"]


def test_chunks_are_marked_first_and_done():
    notes = [{"id": f"{i}.md"} for i in range(c.VAULT_CHUNK * 2 + 1)]
    chunks = list(c.vault_chunks(notes, "snapshot", [], len(notes), False))
    assert [(x["first"], x["done"], len(x["notes"])) for x in chunks] == [(True, False, 300), (False, False, 300), (False, True, 1)]
    empty = list(c.vault_chunks([], "snapshot", [], 0, False))
    assert len(empty) == 1 and empty[0]["first"] and empty[0]["done"]
    delta = list(c.vault_chunks(notes, "delta", ["x.md"], 5, False))
    assert delta[0]["removed"] == ["x.md"] and delta[1]["removed"] == []


def test_chunks_also_respect_a_byte_budget():
    fat = [{"id": f"{i}.md", "links": ["x" * 200] * 400} for i in range(20)]
    chunks = list(c.vault_chunks(fat, "snapshot", [], 20, False))
    assert len(chunks) > 1
    assert all(len(json.dumps(x)) < 600000 for x in chunks)
    assert sum(len(x["notes"]) for x in chunks) == 20


def test_a_note_with_thousands_of_links_is_capped(tmp_path):
    vault(tmp_path, {**{f"t{i}.md": "" for i in range(2500)}, "hub.md": " ".join(f"[[t{i}]]" for i in range(2500))})
    hub = {n["id"]: n for n in c.VaultState(str(tmp_path)).snapshot()}["hub.md"]
    assert len(hub["links"]) == c.VAULT_MAX_LINKS


def test_delta_reports_add_edit_remove_and_resolved_ghosts(tmp_path):
    vault(tmp_path, {"a.md": "[[b]]", "c.md": "plain"})
    st = c.VaultState(str(tmp_path))
    st.snapshot()
    assert st.poll() == ([], [])

    mf.w(tmp_path / "b.md", "new note")  # resolves a's ghost
    up, rem = st.poll()
    assert sorted(x["id"] for x in up) == ["a.md", "b.md"] and rem == []
    assert {x["id"]: x for x in up}["a.md"]["links"] == ["b.md"] and {x["id"]: x for x in up}["a.md"]["ghosts"] == []

    p = tmp_path / "c.md"
    mf.w(p, "plain but longer now [[a]]")
    up, rem = st.poll()
    assert [x["id"] for x in up] == ["c.md"] and up[0]["links"] == ["a.md"]

    (tmp_path / "b.md").unlink()
    up, rem = st.poll()
    assert rem == ["b.md"] and [x["id"] for x in up] == ["a.md"]
    assert up[0]["ghosts"] == ["b"]
    assert st.poll() == ([], [])


# ---- queries --------------------------------------------------------------

def test_vault_check(fx, tmp_path):
    r = q("vault_check", {"path": str(fx.vault)})
    assert r["ok"] and r["data"] == {"path": str(fx.vault), "exists": True, "readable": True, "notes": 6, "truncated": False}
    r = q("vault_check", {"path": str(tmp_path / "nope")})
    assert r["data"]["exists"] is False and r["data"]["notes"] == 0
    assert q("vault_check", {"path": ""})["error"] == "bad_args"
    assert q("vault_check", {"path": 5})["error"] == "bad_args"
    assert q("vault_check", {})["error"] == "bad_args"


def test_vault_check_expands_the_home_folder(fx, monkeypatch):
    monkeypatch.setenv("HOME", str(fx.vault.parent))
    monkeypatch.setenv("USERPROFILE", str(fx.vault.parent))
    r = q("vault_check", {"path": "~/vault"})
    assert r["data"]["notes"] == 6 and r["data"]["path"] == str(fx.vault)


def test_browse_lists_folders_with_note_counts(fx):
    r = q("browse", {"path": str(fx.vault)})
    assert r["ok"]
    d = r["data"]
    assert d["path"] == str(fx.vault) and d["parent"] == str(fx.vault.parent)
    assert d["dirs"] == [{"name": "folder", "notes": 2}]
    top = q("browse", {"path": str(fx.vault.parent)})["data"]
    assert [x["name"] for x in top["dirs"]] == ["vault"]  # .hermes is hidden
    assert q("browse", {"path": str(fx.vault / "nope")})["error"] == "not_found"


def test_browse_defaults_to_the_home_folder(fx, monkeypatch):
    monkeypatch.setenv("HOME", str(fx.vault))
    monkeypatch.setenv("USERPROFILE", str(fx.vault))
    assert q("browse", {})["data"]["path"] == str(fx.vault)


def test_note_returns_the_text(fx):
    r = q("note", {"root": str(fx.vault), "id": "folder/Gamma.md"})
    assert r["ok"] and r["data"]["text"].startswith("Gamma goes [[Index]].")
    assert r["data"]["truncated"] is False and r["data"]["id"] == "folder/Gamma.md"


def test_note_is_cut_at_256_kib(tmp_path):
    mf.w(tmp_path / "big.md", "z" * (c.NOTE_QUERY_BYTES + 50))
    r = q("note", {"root": str(tmp_path), "id": "big.md"})
    assert r["data"]["truncated"] is True and len(r["data"]["text"]) == c.NOTE_QUERY_BYTES


@pytest.mark.parametrize("bad", ["../secret.md", "/etc/passwd.md", "a/../../x.md", "x.txt", "", ".git/ignored.md", "..\\x.md", "a//b.md", "folder/./Gamma.md", "n\0.md"])
def test_note_refuses_paths_outside_the_vault_or_not_markdown(fx, bad):
    assert q("note", {"root": str(fx.vault), "id": bad})["error"] in ("bad_args", "not_found")
    assert q("note", {"root": str(fx.vault), "id": bad})["ok"] is False


def test_note_refuses_a_symlink_that_leaves_the_vault(tmp_path):
    outside = tmp_path / "outside"
    mf.w(outside / "secret.md", "top secret")
    v = tmp_path / "v"
    mf.w(v / "a.md", "ok")
    try:
        os.symlink(outside / "secret.md", v / "link.md")
    except (OSError, NotImplementedError):
        pytest.skip("symlinks not available")
    assert q("note", {"root": str(v), "id": "link.md"})["error"] == "bad_args"


def test_note_not_found_and_bad_arguments(fx):
    assert q("note", {"root": str(fx.vault), "id": "Nope.md"})["error"] == "not_found"
    assert q("note", {"root": str(fx.vault), "id": 3})["error"] == "bad_args"
    assert q("note", {"root": 3, "id": "a.md"})["error"] == "bad_args"


# ---- the stream -----------------------------------------------------------

def run_stream(path, ticks=1, interval=0.1):
    out = subprocess.run(
        [sys.executable, "-u", str(SCRIPT), "/unused-home", "--vault", str(path), "--vault-interval", str(interval), "--ticks", str(ticks)],
        capture_output=True, text=True, timeout=30,
    )
    assert out.returncode == 0, out.stderr
    return [json.loads(l) for l in out.stdout.splitlines() if l.strip()]


def test_the_stream_sends_a_snapshot_and_nothing_else_when_nothing_changes(fx):
    events = run_stream(fx.vault, ticks=3)
    assert [e["type"] for e in events] == ["brain"]
    d = events[0]["data"]
    assert d["mode"] == "snapshot" and d["first"] and d["done"] and d["total"] == 6 and d["truncated"] is False
    assert len(d["notes"]) == 6 and d["removed"] == []


def test_the_stream_reports_a_missing_vault_once(tmp_path):
    events = run_stream(tmp_path / "gone", ticks=3)
    assert [(e["type"], e["data"]["code"]) for e in events] == [("error", "vault_unreadable")]


def test_the_stream_follows_changes_while_running(fx, tmp_path):
    p = subprocess.Popen(
        [sys.executable, "-u", str(SCRIPT), "/unused-home", "--vault", str(fx.vault), "--vault-interval", "0.2"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        first = json.loads(p.stdout.readline())
        assert first["data"]["mode"] == "snapshot"
        mf.w(fx.vault / "Fresh.md", "links [[Index]]")
        second = json.loads(p.stdout.readline())
        assert second["data"]["mode"] == "delta"
        assert [n["id"] for n in second["data"]["notes"]] == ["Fresh.md"] and second["data"]["total"] == 7
    finally:
        p.kill()
        p.wait()


def test_the_vault_stream_writes_nothing(fx):
    before = mf.snapshot(fx.root)
    run_stream(fx.vault, ticks=2)
    q("vault_check", {"path": str(fx.vault)})
    q("browse", {"path": str(fx.vault)})
    q("note", {"root": str(fx.vault), "id": "Index.md"})
    assert mf.snapshot(fx.root) == before


def test_the_script_stays_ascii():
    assert all(ord(ch) < 128 for ch in SCRIPT.read_text(encoding="utf-8"))
