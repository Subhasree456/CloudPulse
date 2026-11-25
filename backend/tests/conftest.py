"""Shared pytest fixtures for the CloudPulse API."""
from __future__ import annotations

import uuid

import pytest

from app import create_app


@pytest.fixture()
def app(tmp_path):
    database = tmp_path / f"cloudpulse-{uuid.uuid4().hex}.sqlite"
    app = create_app(
        {
            "TESTING": True,
            "SECRET_KEY": "test-secret-key-for-cloudpulse",
            "DATABASE_PATH": str(database),
            "DATA_DIR": str(tmp_path),
            "AUTO_SEED": False,
            "SEED_DEMO_DATA": False,
            "ENABLE_BACKGROUND_WORKERS": False,
            "ENABLE_LOCAL_COLLECTOR": False,
            "LOG_LEVEL": "CRITICAL",
            "LOG_DIR": str(tmp_path / "logs"),
        }
    )
    yield app
    app.extensions["cloudpulse_store"].close()


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def users(client):
    admin_response = client.post(
        "/api/auth/register",
        json={"name": "Test Admin", "email": "admin@test.dev", "password": "AdminPass123"},
    )
    assert admin_response.status_code == 201, admin_response.get_json()
    viewer_response = client.post(
        "/api/auth/register",
        json={"name": "Test Viewer", "email": "viewer@test.dev", "password": "ViewerPass123"},
    )
    assert viewer_response.status_code == 201, viewer_response.get_json()
    admin = admin_response.get_json()
    viewer = viewer_response.get_json()
    assert admin["user"]["role"] == "admin"
    assert viewer["user"]["role"] == "viewer"
    return {
        "admin": admin,
        "viewer": viewer,
        "admin_headers": {"Authorization": f"Bearer {admin['token']}"},
        "viewer_headers": {"Authorization": f"Bearer {viewer['token']}"},
    }


@pytest.fixture()
def admin_headers(users):
    return users["admin_headers"]


@pytest.fixture()
def viewer_headers(users):
    return users["viewer_headers"]


@pytest.fixture()
def live_mode(client, admin_headers):
    response = client.put("/api/settings", headers=admin_headers, json={"mode": "live"})
    assert response.status_code == 200, response.get_json()
    return response.get_json()["settings"]


@pytest.fixture()
def server(client, admin_headers, live_mode):
    response = client.post(
        "/api/servers",
        headers=admin_headers,
        json={
            "name": "test-node",
            "hostname": "test-node.internal",
            "ip_address": "10.9.9.9",
            "os": "Ubuntu 24.04",
            "resource_type": "Virtual Machine",
            "region": "test-region",
            "environment": "staging",
            "tags": ["test"],
            "cost_per_hour": 0.1,
        },
    )
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def ingest(client, key, **overrides):
    payload = {
        "cpu_percent": 25,
        "memory_percent": 40,
        "disk_percent": 35,
        "network_in_bps": 12_000_000,
        "network_out_bps": 8_000_000,
        "response_time_ms": 90,
        "memory_total_mb": 8192,
        "memory_available_mb": 4800,
        "uptime_seconds": 86400,
        "load_average": 0.5,
    }
    payload.update(overrides)
    return client.post(
        "/api/telemetry/ingest",
        headers={"X-Agent-Key": key},
        json=payload,
    )


@pytest.fixture()
def ingest_metric():
    return ingest
