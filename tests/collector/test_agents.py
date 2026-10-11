import builtins
import json
import sqlite3

import make_fixture as mf
import mc_collector as c


def by_name(data):
    return {a["profile"]: a for a in data["agents"]}


def test_lists_default_and_marked_profiles_only(fx):
    data, errors = c.collect_agents(str(fx.home), fx.now)
    assert sorted(by_name(data)) == ["atlas", "default", "scout"]
    assert errors == []


def test_status_matrix(fx):
    a = by_name(c.collect_agents(str(fx.home), fx.now)[0])
    assert a["default"]["status"] == "idle"
    assert a["scout"]["status"] == "working"
    assert a["atlas"]["status"] == "offline"
    assert a["scout"]["displayName"] == "Scout"
    assert a["default"]["displayName"] == "default"
    assert a["default"]["platforms"] == ["lightclawbot", "telegram"]
    assert a["scout"]["platforms"] == ["telegram"]
    assert a["default"]["hasSoul"] and a["default"]["hasMemory"] and a["default"]["hasUser"]
    assert a["atlas"]["hasSoul"] and not a["atlas"]["hasMemory"]
    assert a["scout"]["lastActivityTs"] == fx.now - 10
    assert a["scout"]["configMtime"] is not None
    assert a["atlas"]["configMtime"] is None


def test_inactive_messages_are_ignored(fx):
    a = by_name(c.collect_agents(str(fx.home), fx.now)[0])
    assert a["scout"]["lastActivityTs"] == fx.now - 10  # the active=0 message at now-1 is skipped


def test_gateway_info_in_the_per_profile_layout(fx):
    data, _ = c.collect_agents(str(fx.home), fx.now + 4)
    assert data["gateway"] == {"up": True, "heartbeatAgeS": 4.0, "served": []}


def test_an_old_updated_at_does_not_make_a_live_gateway_offline(fx):
    mf.set_updated_at(fx, fx.now - 3 * 86400)
    data, _ = c.collect_agents(str(fx.home), fx.now)
    assert data["gateway"]["up"] is True
    assert data["gateway"]["heartbeatAgeS"] == 259200.0
    assert by_name(data)["default"]["status"] == "idle"


def test_dead_gateway_pid_marks_the_profile_offline(fx):
    mf.write_gateway_state(fx.home, 999999, updated_at=fx.now)
    data, _ = c.collect_agents(str(fx.home), fx.now)
    assert data["gateway"]["up"] is False
    assert by_name(data)["default"]["status"] == "offline"


def test_a_stopped_gateway_state_is_offline_even_if_the_pid_lives(fx):
    mf.write_gateway_state(fx.home, mf.GATEWAY_PID, state="stopped", updated_at=fx.now)
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["default"]["status"] == "offline"


def test_an_exit_reason_means_the_gateway_is_down(fx):
    mf.write_gateway_state(fx.home, mf.GATEWAY_PID, exit_reason="crashed", updated_at=fx.now)
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["default"]["status"] == "offline"


def test_a_missing_gateway_state_falls_back_to_gateway_pid(fx):
    (fx.home / "gateway_state.json").unlink()
    (fx.home / "gateway.pid").write_text(str(mf.GATEWAY_PID))
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["default"]["status"] == "idle"


def test_multiplex_layout_still_marks_served_profiles_active(fx):
    mf.make_multiplex(fx)
    data, _ = c.collect_agents(str(fx.home), fx.now)
    a = by_name(data)
    assert data["gateway"]["served"] == ["default", "atlas"]
    assert a["atlas"]["status"] == "idle"
    assert a["default"]["status"] == "idle"
    # scout is not served, but it has an open session with a message from the last seconds
    assert a["scout"]["status"] == "working"


def test_parked_marker(fx):
    (fx.home / "profiles" / "atlas" / "gateway.parked").write_text("")
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["atlas"]["status"] == "parked"


def test_standalone_gateway_makes_profile_active(fx):
    atlas = fx.home / "profiles" / "atlas"
    mf.write_gateway_state(atlas, mf.GATEWAY_PID, updated_at=fx.now)
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["atlas"]["status"] == "idle"


def test_open_cli_session_with_recent_message_is_active(fx):
    mf.add_profile(fx.home, "cli", markers=("config.yaml",))
    con = mf.make_db(fx.home / "profiles" / "cli" / "state.db", messages=[(fx.now - 100, 1)], sessions=[None])
    con.close()
    assert by_name(c.collect_agents(str(fx.home), fx.now)[0])["cli"]["status"] == "idle"


def test_new_profile_appears(fx):
    mf.add_profile(fx.home, "nova", display_name="Nova")
    assert "nova" in by_name(c.collect_agents(str(fx.home), fx.now)[0])


def test_unsupported_schema_reports_error_and_keeps_going(fx):
    pdir = mf.add_profile(fx.home, "odd", markers=("config.yaml",))
    con = sqlite3.connect(pdir / "state.db")
    con.execute("CREATE TABLE other (x)")
    con.commit()
    con.close()
    data, errors = c.collect_agents(str(fx.home), fx.now)
    assert by_name(data)["odd"]["status"] == "offline"
    assert errors == [{"code": "unsupported_schema", "message": "state.db schema not recognized", "profile": "odd"}]


def test_reads_a_wal_database_while_a_writer_is_open(fx):
    pdir = mf.add_profile(fx.home, "walp", markers=("config.yaml",))
    writer = mf.make_db(pdir / "state.db", messages=[(fx.now - 5, 1)], wal=True)
    try:
        writer.execute("INSERT INTO messages (role, content, timestamp, active) VALUES ('a', 'b', ?, 1)", (fx.now - 2,))
        writer.commit()
        a = by_name(c.collect_agents(str(fx.home), fx.now)[0])
        assert a["walp"]["lastActivityTs"] == fx.now - 2
    finally:
        writer.close()


def test_never_opens_secret_files(fx, monkeypatch):
    opened = []
    real_open = builtins.open

    def spy(file, *a, **k):
        opened.append(str(file))
        return real_open(file, *a, **k)

    monkeypatch.setattr(builtins, "open", spy)
    c.collect_agents(str(fx.home), fx.now)
    sampler = c.Sampler()
    sampler.sample()
    assert opened, "spy should have seen reads"
    assert not [p for p in opened if p.endswith(".env") or p.endswith("auth.json")]


def test_emitted_payload_is_json_serialisable(fx):
    data, _ = c.collect_agents(str(fx.home), fx.now)
    json.dumps(data, allow_nan=False)
