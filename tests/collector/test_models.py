"""Model catalog cache (v2): `--query model_catalog`, read-only."""
import json
import os

import make_fixture as mf
import mc_collector as c

MANIFEST = {
    "version": 1,
    "updated_at": "2026-10-01T10:00:00Z",
    "metadata": {"x": 1},
    "providers": {
        "openrouter": {"metadata": {}, "models": [
            {"id": "z-ai/glm-5.2", "description": "default", "default": True},
            {"id": "moonshotai/kimi-k3", "description": "recommended", "metadata": {"tier": "paid"}},
            {"id": 3},
            "not-a-model",
        ]},
        "nous": {"models": [{"id": "anthropic/claude-opus-4.7"}]},
        "broken": "x",
    },
}


def q(home, args):
    return c.run_query(str(home), "model_catalog", json.dumps(args))


def cache(home, data):
    mf.w(home / "cache" / "model_catalog.json", data if isinstance(data, str) else json.dumps(data))


def test_reads_the_home_cache_and_keeps_only_known_fields(tmp_path):
    cache(tmp_path, MANIFEST)
    r = q(tmp_path, {"profile": "default"})
    assert r["ok"] and r["data"]["found"] is True and r["data"]["updatedAt"] == "2026-10-01T10:00:00Z"
    p = r["data"]["providers"]
    assert p["openrouter"]["models"] == [
        {"id": "z-ai/glm-5.2", "description": "default", "default": True},
        {"id": "moonshotai/kimi-k3", "description": "recommended", "default": False},
    ]
    assert p["nous"]["models"] == [{"id": "anthropic/claude-opus-4.7", "description": "", "default": False}]
    assert "broken" not in p
    assert isinstance(r["data"]["mtime"], int)


def test_a_profile_uses_its_own_cache_first(tmp_path):
    cache(tmp_path, MANIFEST)
    own = dict(MANIFEST, updated_at="2026-10-09T00:00:00Z")
    cache(tmp_path / "profiles" / "scout", own)
    assert q(tmp_path, {"profile": "scout"})["data"]["updatedAt"] == "2026-10-09T00:00:00Z"
    os.makedirs(tmp_path / "profiles" / "atlas")
    assert q(tmp_path, {"profile": "atlas"})["data"]["updatedAt"] == "2026-10-01T10:00:00Z"


def test_missing_or_unusable_cache(tmp_path):
    assert q(tmp_path, {"profile": "default"})["data"] == {"found": False}
    cache(tmp_path, dict(MANIFEST, version=2))
    assert q(tmp_path, {"profile": "default"})["data"] == {"found": False}
    cache(tmp_path, "{nope")
    assert q(tmp_path, {"profile": "default"})["data"] == {"found": False}
    cache(tmp_path, '{"version": 1, "providers": [1]}')
    assert q(tmp_path, {"profile": "default"})["data"] == {"found": False}


def test_caps(tmp_path):
    big = {"version": 1, "providers": {f"p{i}": {"models": [{"id": f"m{j}" + "x" * 300, "description": "d" * 90} for j in range(3)]} for i in range(60)}}
    big["providers"]["p0"]["models"] = [{"id": f"m{j}"} for j in range(2500)]
    cache(tmp_path, big)
    p = q(tmp_path, {"profile": "default"})["data"]["providers"]
    assert len(p) == c.CATALOG_PROVIDERS_MAX
    assert len(p["p0"]["models"]) == c.CATALOG_MODELS_MAX
    assert p["p1"]["models"] == []  # ids over 200 characters are dropped


def test_bad_profile(tmp_path):
    assert q(tmp_path, {"profile": "../x"})["error"] == "bad_args"
    assert q(tmp_path, {"profile": 3})["error"] == "bad_args"
