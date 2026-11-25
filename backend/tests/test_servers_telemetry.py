"""Server management and telemetry ingestion tests."""
from __future__ import annotations


def test_create_list_and_detail(client, admin_headers, server):
    assert server["server"]["name"] == "test-node"
    assert server["server"]["data_source"] == "live"
    assert "agent_key_hash" not in server["server"]
    assert server["agent"]["key"].startswith("cp_live_")

    listing = client.get("/api/servers", headers=admin_headers)
    assert listing.status_code == 200
    body = listing.get_json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == server["server"]["id"]
    assert body["status_counts"]["offline"] == 1

    detail = client.get(f"/api/servers/{server['server']['id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert detail.get_json()["server"]["hostname"] == "test-node.internal"


def test_duplicate_hostname_rejected(client, admin_headers, server):
    duplicate = client.post(
        "/api/servers",
        headers=admin_headers,
        json={"name": "duplicate", "hostname": "test-node.internal"},
    )
    assert duplicate.status_code == 400
    assert duplicate.get_json()["error"]["field"] == "hostname"


def test_agent_ingest_updates_server(client, admin_headers, server, ingest_metric):
    key = server["agent"]["key"]
    response = ingest_metric(
        client,
        key,
        cpu_percent=42.5,
        memory_percent=55,
        disk_percent=61,
        network_in_bps=22_000_000,
        network_out_bps=11_000_000,
    )
    assert response.status_code == 201, response.get_json()
    metric = response.get_json()["metric"]
    assert metric["cpu_percent"] == 42.5
    assert metric["data_source"] == "live"
    assert metric["simulated"] is False

    detail = client.get(f"/api/servers/{server['server']['id']}", headers=admin_headers).get_json()
    assert detail["server"]["status"] == "healthy"
    assert detail["server"]["last_seen"]
    assert detail["server"]["latest_metrics"]["cpu_percent"] == 42.5
    assert len(detail["metrics"]) == 1

    overview = client.get("/api/dashboard/overview?range=1h", headers=admin_headers).get_json()
    assert overview["data_source"] == "live"
    assert overview["metrics"]["total_servers"] == 1
    assert overview["metrics"]["active_servers"] == 1
    assert overview["metrics"]["cpu_percent"] == 42.5


def test_ingest_rejects_bad_agent_key(client):
    response = client.post(
        "/api/telemetry/ingest",
        headers={"X-Agent-Key": "cp_live_not-a-real-key"},
        json={"cpu_percent": 20, "memory_percent": 30, "disk_percent": 40},
    )
    assert response.status_code == 401


def test_ingest_validation(client, server, ingest_metric):
    response = ingest_metric(client, server["agent"]["key"], cpu_percent=140)
    assert response.status_code == 400
    assert response.get_json()["error"]["field"] == "cpu_percent"


def test_metric_history_pagination(client, admin_headers, server, ingest_metric):
    for index in range(5):
        assert ingest_metric(client, server["agent"]["key"], cpu_percent=20 + index).status_code == 201
    response = client.get(
        f"/api/servers/{server['server']['id']}/metrics?range=24h&page=1&limit=2",
        headers=admin_headers,
    )
    assert response.status_code == 200
    body = response.get_json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert body["pages"] == 3
    assert body["items"][0]["cpu_percent"] > body["items"][1]["cpu_percent"]


def test_server_update_and_health_check(client, admin_headers, server, ingest_metric):
    ingest_metric(client, server["agent"]["key"])
    updated = client.patch(
        f"/api/servers/{server['server']['id']}",
        headers=admin_headers,
        json={"name": "renamed-node", "tags": ["beta"], "cost_per_hour": 0.25},
    )
    assert updated.status_code == 200
    assert updated.get_json()["server"]["name"] == "renamed-node"
    assert updated.get_json()["server"]["tags"] == ["beta"]

    checked = client.post(f"/api/servers/{server['server']['id']}/check", headers=admin_headers)
    assert checked.status_code == 200
    assert checked.get_json()["online"] is True


def test_rotate_and_delete_target(client, admin_headers, server, ingest_metric):
    server_id = server["server"]["id"]
    old_key = server["agent"]["key"]
    rotated = client.post(f"/api/servers/{server_id}/rotate-key", headers=admin_headers)
    assert rotated.status_code == 200
    new_key = rotated.get_json()["agent"]["key"]
    assert new_key != old_key
    assert ingest_metric(client, old_key).status_code == 401
    assert ingest_metric(client, new_key).status_code == 201

    deleted = client.delete(f"/api/servers/{server_id}", headers=admin_headers)
    assert deleted.status_code == 200
    assert client.get(f"/api/servers/{server_id}", headers=admin_headers).status_code == 404
    listing = client.get("/api/servers", headers=admin_headers).get_json()
    assert listing["total"] == 0


def test_agent_self_enrollment(client, app):
    app.config["AGENT_ENROLLMENT_TOKEN"] = "enroll-secret"
    missing = client.post("/api/servers/register", json={"name": "n", "hostname": "h"})
    assert missing.status_code == 403
    denied = client.post(
        "/api/servers/register",
        headers={"X-Enrollment-Token": "wrong"},
        json={"name": "n", "hostname": "h"},
    )
    assert denied.status_code == 403
    enrolled = client.post(
        "/api/servers/register",
        headers={"X-Enrollment-Token": "enroll-secret"},
        json={"name": "self-enrolled", "hostname": "self.internal", "resource_type": "Container"},
    )
    assert enrolled.status_code == 201
    assert enrolled.get_json()["agent_key"].startswith("cp_live_")
