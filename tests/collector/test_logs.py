import json
import os

import pytest

import make_fixture as mf
import mc_collector as c


def q(fx, cmd, args):
    return c.run_query(str(fx.home), cmd, json.dumps(args))


def read(fx, **over):
    args = {"profile": "default", "file": "agent.log", "limit": 500}
    args.update(over)
    return q(fx, "logs_read", args)


# ---- logs_list --------------------------------------------------------------

def test_list_shows_only_existing_log_files_with_size_and_mtime(fx):
    mf.add_logs(fx)
    r = q(fx, "logs_list", {"profiles": []})
    assert r["ok"] is True
    files = {(f["profile"], f["name"]): f for f in r["data"]["files"]}
    assert set(files) == {("default", "agent.log"), ("default", "errors.log"), ("scout", "gateway.log")}
    path = mf.log_dir(fx, "default") / "agent.log"
    assert files[("default", "agent.log")]["size"] == path.stat().st_size
    assert files[("default", "agent.log")]["mtime"] == pytest.approx(path.stat().st_mtime, abs=1)


def test_list_filters_by_profile_and_skips_agents_without_logs(fx):
    mf.add_logs(fx)
    r = q(fx, "logs_list", {"profiles": ["scout"]})
    assert [(f["profile"], f["name"]) for f in r["data"]["files"]] == [("scout", "gateway.log")]
    assert q(fx, "logs_list", {"profiles": ["atlas"]})["data"]["files"] == []


def test_list_ignores_a_link_that_leaves_the_logs_folder(fx, tmp_path):
    secret = tmp_path / "outside.txt"
    secret.write_text("secret\n")
    d = mf.log_dir(fx, "default")
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(secret, d / "tool_calls.log")
    except OSError:
        pytest.skip("symlinks need extra privileges here")
    assert q(fx, "logs_list", {"profiles": ["default"]})["data"]["files"] == []
    assert read(fx, file="tool_calls.log")["error"] == "not_found"


def test_list_bad_args(fx):
    assert q(fx, "logs_list", {"profiles": ["../x"]})["error"] == "bad_args"
    assert q(fx, "logs_list", {"profiles": "default"})["error"] == "bad_args"


# ---- logs_read: the last lines ----------------------------------------------

def test_read_returns_the_last_lines_and_where_the_file_ends(fx):
    mf.write_log(fx, "default", "agent.log", [f"line {i}" for i in range(1200)])
    r = read(fx, limit=500)
    d = r["data"]
    assert d["lines"][0] == "line 700" and d["lines"][-1] == "line 1199" and len(d["lines"]) == 500
    assert d["more"] is True and d["startOffset"] > 0
    assert d["offset"] == d["size"] == (mf.log_dir(fx, "default") / "agent.log").stat().st_size
    assert d["reset"] is False and d["skipped"] is False


def test_read_a_short_file_has_nothing_older(fx):
    mf.add_logs(fx)
    d = read(fx)["data"]
    assert len(d["lines"]) == 6 and d["more"] is False and d["startOffset"] == 0
    assert d["lines"][4] == "    Traceback line that belongs to the error above"


def test_read_finds_the_last_lines_of_a_file_much_larger_than_one_chunk(fx):
    body = "x" * 190
    mf.write_log(fx, "default", "agent.log", [f"{i:05d} {body}" for i in range(3000)])
    d = read(fx, limit=1000)["data"]
    assert len(d["lines"]) == 1000
    assert d["lines"][0].startswith("02000 ") and d["lines"][-1].startswith("02999 ")


def test_read_cuts_long_lines_and_replaces_bad_bytes(fx):
    path = mf.write_log(fx, "default", "agent.log", ["a" * 5000])
    with open(path, "ab") as f:
        f.write(b"bad \xff\xfe bytes\n")
    lines = read(fx)["data"]["lines"]
    assert len(lines[0]) == 4000
    assert lines[1] == "bad �� bytes"


# ---- logs_read: following ---------------------------------------------------

def test_read_after_an_offset_returns_only_the_new_lines(fx):
    mf.add_logs(fx)
    first = read(fx)["data"]
    mf.write_log(fx, "default", "agent.log", ["new one", "new two"], mode="a")
    d = read(fx, after=first["offset"])["data"]
    assert d["lines"] == ["new one", "new two"]
    assert d["offset"] == d["size"] and d["more"] is False
    assert read(fx, after=d["offset"])["data"]["lines"] == []


def test_a_partial_last_line_waits_for_its_newline(fx):
    mf.write_log(fx, "default", "agent.log", ["whole"])
    off = read(fx)["data"]["offset"]
    mf.write_log(fx, "default", "agent.log", ["half a li"], mode="a", newline=False)
    d = read(fx, after=off)["data"]
    assert d["lines"] == [] and d["offset"] == off
    mf.write_log(fx, "default", "agent.log", ["ne"], mode="a")
    assert read(fx, after=off)["data"]["lines"] == ["half a line"]


def test_a_rotated_file_is_reported_with_its_last_lines(fx):
    mf.write_log(fx, "default", "agent.log", [f"old {i}" for i in range(100)])
    off = read(fx)["data"]["offset"]
    mf.write_log(fx, "default", "agent.log", ["fresh 1", "fresh 2"])
    d = read(fx, after=off)["data"]
    assert d["reset"] is True and d["lines"] == ["fresh 1", "fresh 2"]


def test_too_many_new_bytes_are_skipped_but_the_newest_come_back(fx):
    mf.write_log(fx, "default", "agent.log", ["start"])
    off = read(fx)["data"]["offset"]
    mf.write_log(fx, "default", "agent.log", [f"{i:06d} " + "y" * 90 for i in range(4000)], mode="a")
    d = read(fx, after=off, limit=300)["data"]
    assert d["skipped"] is True and len(d["lines"]) <= 300
    assert d["lines"][-1].startswith("003999 ")


# ---- logs_read: errors and bad arguments ------------------------------------

def test_read_errors(fx):
    mf.add_logs(fx)
    assert read(fx, file="other.log")["error"] == "bad_args"
    assert read(fx, file="../../etc/passwd")["error"] == "bad_args"
    assert read(fx, profile="../x")["error"] == "bad_args"
    assert read(fx, after=-1)["error"] == "bad_args"
    assert read(fx, after="1")["error"] == "bad_args"
    assert read(fx, limit=0)["error"] == "bad_args"
    assert read(fx, limit=True)["error"] == "bad_args"
    assert read(fx, file="tool_calls.log")["error"] == "not_found"
    assert read(fx, profile="ghost")["error"] == "not_found"
