import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "collector"))
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))

import make_fixture as mf  # noqa: E402
import mc_collector as c  # noqa: E402


@pytest.fixture
def fx(tmp_path, monkeypatch):
    f = mf.make_fixture(tmp_path / "fx", now=1_760_000_000.0)
    monkeypatch.setattr(c, "PROC", str(f.proc))
    monkeypatch.setattr(c, "SYSFS", str(f.sysfs))
    monkeypatch.setattr(c, "HZ", 100)
    monkeypatch.setattr(c, "PAGE", 4096)
    return f
