from pathlib import Path

import make_fixture as mf
import mc_collector as c

ROOT = Path(__file__).resolve().parents[2]


def test_cpu_pct_math():
    assert c.cpu_pct((900, 1000), (960, 1100)) == 40.0
    assert c.cpu_pct((5, 10), (5, 10)) == 0.0


def test_idle_includes_iowait():
    t = "cpu  10 0 10 70 10 0 0 0\ncpu0 10 0 10 70 10 0 0 0\n"
    assert c.parse_cpu_stat(t)["cpu"] == (80, 100)


def test_summarize_mem():
    info = c.parse_meminfo(mf.MEMINFO)
    m = c.summarize_mem(info)
    assert m["total"] == 16384000 * 1024
    assert m["available"] == 10137600 * 1024
    assert m["used"] == m["total"] - m["available"]
    assert m["cached"] == (5324800 + 102400 + 204800) * 1024
    assert m["swapUsed"] == (2097152 - 2000000) * 1024


def test_mounts_filtered_and_unescaped():
    text = (
        "proc /proc proc rw 0 0\n"
        "/dev/vda1 /srv/my\\040disk ext4 rw 0 0\n"
        "tmpfs /run tmpfs rw 0 0\n"
        "overlay / overlay rw 0 0\n"
    )
    assert c.parse_mounts(text) == [("/srv/my disk", "ext4"), ("/", "overlay")]


def test_net_dev_skips_loopback():
    t = "h1\nh2\n    lo: 1 1 0 0 0 0 0 0 2 1 0 0 0 0 0 0\n  eth0: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0\n"
    assert c.parse_net_dev(t) == {"eth0": (10, 20)}


def test_diskstats_ignores_partitions():
    t = "   8       0 vda 1 0 100 0 1 0 200 0 0 0 0\n   8       1 vda1 1 0 999 0 1 0 999 0 0 0 0\n 259 0 nvme0n1 1 0 10 0 1 0 20 0 0 0 0\n"
    assert c.parse_diskstats(t) == ((100 + 10) * 512, (200 + 20) * 512)


def test_first_sample_has_zero_rates(fx):
    m = c.Sampler(clock=lambda: 0.0).sample()
    assert m["cpu"]["total"] == 0.0
    assert m["net"][0]["rxBps"] == 0.0
    assert m["io"]["readBps"] == 0.0


def test_sampler_computes_rates(fx):
    t = iter([0.0, 1.0])
    s = c.Sampler(clock=lambda: next(t))
    s.sample()
    mf.advance(fx, 1)
    m = s.sample()
    assert m["cpu"]["total"] == 40.0
    assert m["cpu"]["cores"] == [40.0] * mf.CORES
    assert m["cpu"]["load"] == [1.42, 0.98, 0.77]
    assert m["cpu"]["uptimeS"] == 1038240.55
    assert m["cpu"]["tempC"] == 52.0
    assert m["net"][0]["name"] == "eth0"
    assert m["net"][0]["rxBps"] == 500_000
    assert m["net"][0]["txBps"] == 100_000
    assert m["io"] == {"readBps": 1_048_576, "writeBps": 524_288}
    assert m["tasks"] == 3
    assert [d["fs"] for d in m["disks"]] == ["ext4", "ext4"]


def test_procs_flag_hermes_and_compute_cpu(fx):
    t = iter([0.0, 1.0])
    s = c.Sampler(clock=lambda: next(t))
    s.sample()
    mf.advance(fx, 1)
    m = s.sample()
    gw = next(p for p in m["procs"] if p["pid"] == mf.GATEWAY_PID)
    assert gw["hermes"] is True
    assert gw["cpu"] == 25.0
    assert gw["rss"] == 25600 * 4096
    assert gw["user"] in ("0", "root")
    assert "hermes_cli.main gateway run" in gw["cmd"]
    node = next(p for p in m["procs"] if p["pid"] == 912)
    assert node["hermes"] is False


def test_collector_source_is_ascii():
    (ROOT / "collector" / "mc_collector.py").read_bytes().decode("ascii")
