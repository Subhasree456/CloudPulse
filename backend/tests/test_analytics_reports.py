"""Analytics, report and export tests."""
from __future__ import annotations


def test_analytics_aggregation(client, admin_headers, server, ingest_metric):
    for index in range(6):
        response = ingest_metric(
            client,
            server["agent"]["key"],
            cpu_percent=30 + index,
            memory_percent=45 + index,
            network_in_bps=10_000_000 + index,
            network_out_bps=5_000_000,
        )
        assert response.status_code == 201

    response = client.get("/api/analytics?range=24h", headers=admin_headers)
    assert response.status_code == 200
    body = response.get_json()
    assert body["data_source"] == "live"
    assert body["totals"]["servers"] == 1
    assert body["totals"]["samples"] == 6
    assert len(body["comparisons"]) == 1
    assert body["comparisons"][0]["cpu_percent"] == 32.5
    assert body["costs"]["monthly_estimated"] == 73.0
    assert body["series"]

    filtered = client.get(
        f"/api/analytics?range=24h&server_id={server['server']['id']}",
        headers=admin_headers,
    )
    assert filtered.status_code == 200
    assert filtered.get_json()["totals"]["samples"] == 6


def test_analytics_custom_date_range(client, admin_headers, live_mode):
    response = client.get(
        "/api/analytics?from=2025-01-01&to=2025-01-02",
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.get_json()["range"]["label"] == "custom"
    invalid = client.get("/api/analytics?from=2025-01-03&to=2025-01-01", headers=admin_headers)
    assert invalid.status_code == 400


def test_report_preview_pdf_and_csv(client, admin_headers, server, ingest_metric):
    ingest_metric(client, server["agent"]["key"], cpu_percent=71, memory_percent=62)

    preview = client.get("/api/reports/summary?type=daily", headers=admin_headers)
    assert preview.status_code == 200
    report = preview.get_json()
    assert report["type"] == "daily"
    assert report["data_source"] == "live"
    assert report["summary"]["servers"] == 1
    assert report["summary"]["samples"] == 1
    assert report["servers"][0]["availability"] == 100.0

    pdf = client.get("/api/reports/pdf?type=daily", headers=admin_headers)
    assert pdf.status_code == 200
    assert pdf.headers["Content-Type"].startswith("application/pdf")
    assert pdf.data.startswith(b"%PDF")
    assert len(pdf.data) > 2000

    history = client.get("/api/reports", headers=admin_headers).get_json()
    assert history["total"] == 1
    assert history["items"][0]["format"] == "pdf"
    assert history["items"][0]["created_by"] == "Test Admin"

    csv_response = client.get("/api/reports/export?range=24h&dataset=telemetry", headers=admin_headers)
    assert csv_response.status_code == 200
    assert "text/csv" in csv_response.headers["Content-Type"]
    text = csv_response.data.decode("utf-8-sig")
    assert "cpu_percent" in text
    assert "test-node" in text
    assert "yes" not in text.splitlines()[1].split(",")


def test_weekly_report_and_invalid_type(client, admin_headers, server, ingest_metric):
    ingest_metric(client, server["agent"]["key"])
    weekly = client.get("/api/reports/summary?type=weekly", headers=admin_headers)
    assert weekly.status_code == 200
    assert weekly.get_json()["type"] == "weekly"
    assert "to" in weekly.get_json()["period"]

    invalid = client.get("/api/reports/summary?type=monthly", headers=admin_headers)
    assert invalid.status_code == 400

    bad_date = client.get("/api/reports/summary?type=daily&date=not-a-date", headers=admin_headers)
    assert bad_date.status_code == 400


def test_services_inventory_is_honest(client, admin_headers, server):
    response = client.get("/api/services", headers=admin_headers)
    assert response.status_code == 200
    body = response.get_json()
    assert body["summary"]["live_targets"] == 1
    assert body["summary"]["conceptual_services"] >= 1
    flattened = [item for category in body["categories"] for item in category["items"]]
    aws = next(item for item in flattened if item["name"] == "AWS CloudWatch")
    assert aws["kind"] == "conceptual"
    assert aws["verified"] is False
    assert "not" in body["disclaimer"].lower()
