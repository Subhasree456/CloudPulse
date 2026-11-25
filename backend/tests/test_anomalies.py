"""Anomaly detection tests."""
from __future__ import annotations

import math
from datetime import timedelta

from app.utils import iso, new_id, utcnow


def _seed_rows(app, server_id: str, count: int = 80, spikes: bool = True):
    store = app.extensions["cloudpulse_store"]
    now = utcnow()
    rows = []
    for index in range(count):
        timestamp = now - timedelta(minutes=count - index)
        cpu = 30 + math.sin(index / 4) * 4
        memory = 42 + math.sin(index / 6) * 3
        network_in = 12_000_000 + (index % 5) * 300_000
        if spikes and index in {40, 41, 42}:
            cpu = 98
            network_in = 480_000_000
        rows.append(
            {
                "id": new_id("tel_"),
                "server_id": server_id,
                "server_name": "test-node",
                "timestamp": iso(timestamp),
                "cpu_percent": round(cpu, 2),
                "memory_percent": round(memory, 2),
                "memory_available_mb": 4000,
                "memory_total_mb": 8192,
                "disk_percent": 44.0 + index * 0.01,
                "network_in_bps": int(network_in),
                "network_out_bps": 8_000_000,
                "network_throughput_bps": int(network_in) + 8_000_000,
                "response_time_ms": 90 + (index % 7) * 2,
                "uptime_seconds": 86400 + index * 60,
                "load_average": 0.8,
                "data_source": "live",
                "simulated": False,
                "received_at": iso(now),
            }
        )
    store.insert_many("telemetry", rows)
    return rows


def test_insufficient_data_message(client, admin_headers, server):
    _seed_rows(client.application, server["server"]["id"], count=8, spikes=False)
    response = client.post("/api/anomalies/detect", headers=admin_headers)
    assert response.status_code == 200
    run = response.get_json()["run"]
    assert run["status"] == "insufficient_data"
    assert run["analyzed_servers"] == 0

    listing = client.get("/api/anomalies?range=7d", headers=admin_headers).get_json()
    assert listing["items"] == []
    assert "No anomalies" in listing["message"]


def test_isolation_forest_detects_spike(client, admin_headers, viewer_headers, server):
    _seed_rows(client.application, server["server"]["id"], count=90, spikes=True)
    forbidden = client.post("/api/anomalies/detect", headers=viewer_headers)
    assert forbidden.status_code == 403

    response = client.post("/api/anomalies/detect", headers=admin_headers)
    assert response.status_code == 200
    run = response.get_json()["run"]
    assert run["status"] == "completed"
    assert run["analyzed_servers"] == 1
    assert run["analyzed_points"] == 90
    assert run["anomalies_found"] >= 1
    assert "IsolationForest" not in response.get_json()["message"]

    listing = client.get("/api/anomalies?range=7d", headers=admin_headers).get_json()
    assert listing["summary"]["total"] >= 1
    assert listing["items"][0]["detection_method"] == "IsolationForest"
    assert listing["items"][0]["anomaly_score"] >= 0.5
    assert listing["items"][0]["server_id"] == server["server"]["id"]

    timeline = client.get("/api/anomalies/timeline", headers=admin_headers)
    assert timeline.status_code == 200
    assert timeline.get_json()["items"]

    runs = client.get("/api/anomalies/runs", headers=admin_headers).get_json()
    assert runs["total"] >= 1


def test_detection_can_be_disabled(client, admin_headers, live_mode):
    client.put("/api/settings", headers=admin_headers, json={"anomaly_detection_enabled": False})
    response = client.post("/api/anomalies/detect", headers=admin_headers)
    assert response.status_code == 200
    assert response.get_json()["run"]["status"] == "disabled"
