"""Alert lifecycle, settings and RBAC tests."""
from __future__ import annotations


def test_critical_cpu_creates_single_alert(client, admin_headers, viewer_headers, server, ingest_metric):
    key = server["agent"]["key"]
    first = ingest_metric(client, key, cpu_percent=95)
    assert first.status_code == 201
    alerts = client.get("/api/alerts", headers=admin_headers).get_json()
    assert alerts["total"] == 1
    alert = alerts["items"][0]
    assert alert["category"] == "cpu"
    assert alert["severity"] == "critical"
    assert alert["status"] == "active"
    assert "95" in alert["description"]
    alert_id = alert["id"]

    # The same continuously active condition must not create duplicates.
    ingest_metric(client, key, cpu_percent=97)
    again = client.get("/api/alerts", headers=admin_headers).get_json()
    assert again["total"] == 1

    forbidden = client.post(f"/api/alerts/{alert_id}/acknowledge", headers=viewer_headers)
    assert forbidden.status_code == 403

    acknowledged = client.post(f"/api/alerts/{alert_id}/acknowledge", headers=admin_headers)
    assert acknowledged.status_code == 200
    assert acknowledged.get_json()["alert"]["status"] == "acknowledged"
    assert acknowledged.get_json()["alert"]["acknowledged_by"] == "Test Admin"

    resolved = client.post(
        f"/api/alerts/{alert_id}/resolve",
        headers=admin_headers,
        json={"reason": "Load test finished."},
    )
    assert resolved.status_code == 200
    assert resolved.get_json()["alert"]["status"] == "resolved"
    assert resolved.get_json()["alert"]["resolution_reason"] == "Load test finished."

    summary = client.get("/api/alerts/summary/current", headers=admin_headers).get_json()
    assert summary["summary"]["resolved"] == 1
    assert summary["summary"]["active"] == 0


def test_warning_thresholds_and_severity_escalation(client, admin_headers, server, ingest_metric):
    key = server["agent"]["key"]
    ingest_metric(client, key, memory_percent=80)
    alerts = client.get("/api/alerts", headers=admin_headers).get_json()
    assert alerts["total"] == 1
    assert alerts["items"][0]["severity"] == "warning"

    ingest_metric(client, key, memory_percent=95)
    alerts = client.get("/api/alerts", headers=admin_headers).get_json()
    assert alerts["total"] == 1
    assert alerts["items"][0]["severity"] == "critical"
    assert alerts["items"][0]["status"] == "active"


def test_settings_validation_and_threshold_update(client, admin_headers, viewer_headers, live_mode):
    read = client.get("/api/settings", headers=admin_headers)
    assert read.status_code == 200
    settings = read.get_json()["settings"]
    assert settings["mode"] == "live"
    assert settings["thresholds"]["cpu"]["critical"] == 85

    forbidden = client.put("/api/settings", headers=viewer_headers, json={"mode": "demo"})
    assert forbidden.status_code == 403

    invalid = client.put(
        "/api/settings",
        headers=admin_headers,
        json={"thresholds": {"cpu": {"warning": 90, "critical": 80}}},
    )
    assert invalid.status_code == 400

    invalid_interval = client.put(
        "/api/settings",
        headers=admin_headers,
        json={"monitoring_interval_seconds": 1},
    )
    assert invalid_interval.status_code == 400

    updated = client.put(
        "/api/settings",
        headers=admin_headers,
        json={
            "monitoring_interval_seconds": 15,
            "thresholds": {"cpu": {"warning": 60, "critical": 80}},
            "retention_days": 14,
        },
    )
    assert updated.status_code == 200
    body = updated.get_json()
    assert body["settings"]["monitoring_interval_seconds"] == 15
    assert body["settings"]["thresholds"]["cpu"] == {"warning": 60, "critical": 80}
    assert body["effective_offline_seconds"] >= 45

    read_again = client.get("/api/settings", headers=admin_headers).get_json()
    assert read_again["settings"]["retention_days"] == 14


def test_alert_filtering(client, admin_headers, server, ingest_metric):
    ingest_metric(client, server["agent"]["key"], cpu_percent=95, disk_percent=90, memory_percent=92)
    all_alerts = client.get("/api/alerts", headers=admin_headers).get_json()
    assert all_alerts["total"] >= 3

    critical = client.get("/api/alerts?severity=critical", headers=admin_headers).get_json()
    assert critical["total"] >= 2
    assert all(item["severity"] == "critical" for item in critical["items"])

    cpu = client.get("/api/alerts?category=cpu", headers=admin_headers).get_json()
    assert cpu["total"] == 1
    assert cpu["items"][0]["category"] == "cpu"

    empty = client.get("/api/alerts?status=resolved", headers=admin_headers).get_json()
    assert empty["total"] == 0
