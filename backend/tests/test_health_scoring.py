"""Unit tests for health scoring, range parsing and bucket aggregation."""
from __future__ import annotations

from datetime import timedelta

from app.services.analytics import build_series
from app.services.health import classify_score, health_score
from app.utils import iso, parse_range, utcnow


def test_health_score_classification():
    healthy = health_score(
        {
            "cpu_percent": 20,
            "memory_percent": 30,
            "disk_percent": 40,
            "response_time_ms": 80,
            "network_throughput_bps": 10_000_000,
        }
    )
    assert healthy == 100
    assert classify_score(healthy) == "excellent"
    assert classify_score(89) == "healthy"
    assert classify_score(70) == "warning"
    assert classify_score(30) == "critical"

    loaded = health_score(
        {
            "cpu_percent": 96,
            "memory_percent": 95,
            "disk_percent": 96,
            "response_time_ms": 1200,
            "network_throughput_bps": 900_000_000,
        }
    )
    assert 0 <= loaded < 40
    assert health_score({"cpu_percent": 1}, online=False) == 0


def test_parse_range_presets_and_validation():
    with __import__("flask").Flask(__name__).test_request_context("/?range=1h"):
        info = parse_range()
        assert info["label"] == "1h"
        assert info["seconds"] == 3600
        assert info["end"] > info["start"]

    app = __import__("flask").Flask(__name__)
    with app.test_request_context("/?range=invalid"):
        try:
            parse_range()
        except Exception as exc:  # noqa: BLE001
            assert "range must be" in str(exc)
        else:
            raise AssertionError("Invalid range should fail")


def test_build_series_averages_and_buckets():
    end = utcnow().replace(microsecond=0)
    start = end - timedelta(minutes=10)
    rows = [
        {
            "timestamp": iso(start + timedelta(seconds=60)),
            "cpu_percent": 20,
            "memory_percent": 30,
            "disk_percent": 40,
            "network_in_bps": 1_000_000,
            "network_out_bps": 2_000_000,
            "response_time_ms": 100,
        },
        {
            "timestamp": iso(start + timedelta(seconds=90)),
            "cpu_percent": 40,
            "memory_percent": 50,
            "disk_percent": 60,
            "network_in_bps": 3_000_000,
            "network_out_bps": 4_000_000,
            "response_time_ms": 200,
        },
    ]
    series = build_series(rows, start, end, max_points=5)
    assert series
    combined = series[0]
    assert combined["samples"] == 2
    assert combined["cpu_percent"] == 30
    assert combined["network_mbps"] == 5
    assert combined["response_time_ms"] == 150
