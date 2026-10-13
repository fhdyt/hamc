import json
import os
from pathlib import Path

import make_fixture as mf
import mc_collector as c


def q(home, cmd, args):
    return c.run_query(str(home), cmd, json.dumps(args))


def skills(fx, **args):
    r = q(fx.home, "skills_list", args)
    assert r["ok"], r
    return {s["name"]: s for s in r["data"]["skills"]}, r["data"]["profiles"]


# ---- frontmatter --------------------------------------------------------------

def test_frontmatter_subset():
    fm, body = c.parse_frontmatter(mf.SKILL_MAPS)
    assert fm["name"] == "maps"
    assert fm["metadata"]["hermes"]["tags"] == ["maps", "routing"]
    assert fm["metadata"]["hermes"]["requires_toolsets"] == ["terminal"]
    assert fm["required_environment_variables"] == [{"name": "MAPS_TOKEN", "prompt": "Token for the tile server"}]
    assert body.strip().startswith("# Maps")
    fm, _ = c.parse_frontmatter(mf.SKILL_NOTION)
    assert fm["description"] == "Notion API + ntn CLI: pages, databases, markdown, Workers."
    assert fm["platforms"] == ["linux", "macos", "windows"]
    assert fm["prerequisites"]["env_vars"] == ["NOTION_API_KEY"]


def test_frontmatter_odd_inputs():
    assert c.parse_frontmatter("# no frontmatter\n") == ({}, "# no frontmatter\n")
    fm, _ = c.parse_frontmatter("---\nname: x\ndesc: |\n  line one\n  line two\ntags:\n- a\n- 'b, c'\nbad line\nx: [1, \"2, 3\"]\n---\nbody")
    assert fm["name"] == "x" and fm["desc"] == "line one\nline two" and fm["tags"] == ["a", "b, c"] and fm["x"] == ["1", "2, 3"]
    fm, _ = c.parse_frontmatter("﻿---\nname: unterminated\n")
    assert fm == {"name": "unterminated"}


def test_env_names_merge_and_never_values():
    fm = {"required_environment_variables": ["A_KEY", {"name": "B_KEY", "prompt": "p"}, {"name": "bad name"}],
          "setup": {"collect_secrets": [{"env_var": "C_KEY"}]}, "prerequisites": {"env_vars": ["A_KEY", "D_KEY"]}}
    assert c.skill_env_names(fm) == ["A_KEY", "B_KEY", "C_KEY", "D_KEY"]


# ---- skills_list --------------------------------------------------------------

def test_lists_skills_with_hermes_provenance_and_state(fx):
    by, profiles = skills(fx)
    assert set(by) == {"arxiv-digest", "pinned-helper", "old-scraper", "notion", "maps", "hub-tool", "retired"}
    assert by["hub-tool"]["origin"] == "hub"
    assert by["notion"]["origin"] == by["maps"]["origin"] == "bundled"
    a = by["arxiv-digest"]
    assert a["origin"] == "agent" and a["createdBy"] == "agent" and a["category"] == "research" and a["path"] == "research/arxiv-digest"
    assert (a["useCount"], a["viewCount"], a["patchCount"]) == (14, 20, 2)
    assert a["lastUsedAt"] == fx.now - 3600
    assert by["old-scraper"]["state"] == "stale"
    assert by["pinned-helper"]["pinned"] is True and by["pinned-helper"]["tags"] == ["helper", "pin"]
    assert by["retired"]["state"] == "archived" and by["retired"]["path"] == ".archive/retired"
    assert by["notion"]["envNames"] == ["NOTION_API_KEY"] and by["notion"]["version"] == "2.0.0"
    assert by["maps"]["requiresToolsets"] == ["terminal"] and by["maps"]["envNames"] == ["MAPS_TOKEN"]
    assert {p["profile"]: p["total"] for p in profiles} == {"default": 7, "atlas": 0, "scout": 0}


def test_support_folders_and_excluded_folders_are_not_skills(fx):
    by, _ = skills(fx)
    assert "not-a-skill" not in by and "ignored" not in by


def test_profile_filter_and_bad_args(fx):
    by, profiles = skills(fx, profiles=["scout"])
    assert by == {} and [p["profile"] for p in profiles] == ["scout"]
    assert q(fx.home, "skills_list", {"profiles": ["../x"]}) == {"ok": False, "error": "bad_args"}


def test_a_symlinked_skill_file_out_of_the_tree_is_skipped(fx):
    d = fx.home / "skills" / "evil" / "leak"
    d.mkdir(parents=True)
    try:
        os.symlink(fx.home / ".env", d / "SKILL.md")
    except (OSError, NotImplementedError):
        return
    by, _ = skills(fx)
    assert "leak" not in by
    assert q(fx.home, "skill_read", {"profile": "default", "path": "evil/leak"}) == {"ok": False, "error": "not_found"}


def test_broken_usage_and_lock_files_are_tolerated(fx):
    (fx.home / "skills" / ".usage.json").write_text("{not json")
    (fx.home / "skills" / ".hub" / "lock.json").write_text("[]")
    by, _ = skills(fx)
    assert by["arxiv-digest"]["useCount"] == 0 and by["hub-tool"]["origin"] == "agent"


# ---- skill_read ---------------------------------------------------------------

def test_reads_one_skill_by_its_listed_path(fx):
    r = q(fx.home, "skill_read", {"profile": "default", "path": "productivity/notion"})
    assert r["ok"] and r["data"]["text"].startswith("---\nname: notion") and r["data"]["truncated"] is False
    r = q(fx.home, "skill_read", {"profile": "default", "path": ".archive/retired"})
    assert r["ok"]
    for bad in ("../../x", "/etc", "a/../../b", "", "a b"):
        assert q(fx.home, "skill_read", {"profile": "default", "path": bad})["error"] == "bad_args"
    assert q(fx.home, "skill_read", {"profile": "default", "path": "nope/missing"})["error"] == "not_found"


def test_skill_read_cuts_big_files(fx):
    mf.w(fx.home / "skills" / "big" / "huge" / "SKILL.md", "x" * 300000)
    r = q(fx.home, "skill_read", {"profile": "default", "path": "big/huge"})
    assert len(r["data"]["text"]) == 262144 and r["data"]["truncated"] is True


# ---- ledger and blobs ---------------------------------------------------------

def test_ledger_newest_first_with_files_and_notes(fx):
    r = q(fx.home, "skills_ledger", {"profile": "default"})
    d = r["data"]
    assert d["exists"] is True
    assert [e["id"] for e in d["entries"]] == ["eee555fff666", "ccc333ddd444", "aaa111bbb222"]
    patch = d["entries"][1]
    assert patch["actor"] == "agent" and patch["action"] == "patch" and patch["note"] == "added cs.LG"
    assert patch["files"][0]["path"] == "research/arxiv-digest/SKILL.md"
    assert patch["files"][0]["before"] and patch["files"][0]["after"]
    assert d["entries"][2]["sessionId"] == "s-default-1"
    assert q(fx.home, "skills_ledger", {"profile": "default", "limit": 1})["data"]["entries"][0]["id"] == "eee555fff666"
    assert q(fx.home, "skills_ledger", {"profile": "scout"})["data"] == {"profile": "scout", "entries": [], "exists": False, "truncated": False}


def test_blobs_by_sha_only(fx):
    e = q(fx.home, "skills_ledger", {"profile": "default"})["data"]["entries"][1]["files"][0]
    r = q(fx.home, "skills_blobs", {"profile": "default", "shas": [e["before"], e["after"], "0" * 64]})["data"]["blobs"]
    assert "Read cs.CL.\n" in r[0]["text"] and "cs.LG" in r[1]["text"]
    assert r[2] == {"sha": "0" * 64, "error": "not_found"}
    for shas in ([], ["../x"], ["A" * 64], ["a" * 64] * 5):
        assert q(fx.home, "skills_blobs", {"profile": "default", "shas": shas})["error"] == "bad_args"
