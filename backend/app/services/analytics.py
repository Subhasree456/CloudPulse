"""Aggregation helpers for the dashboard and analytics pages."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from ..utils import iso, parse_iso, utcnow
from .alerts import alert_summary
from .settings import effective_offline_seconds

METRIC_DEFAULTS = {
    "cpu_percent": 0.0,
    "memory_percent": 0.0,
    "disk_percent": 0.0,
    "response_time_ms": 0.0,
    "network_in_bps": 0.0,
    "network_out_bps": 0.0,
    "network_throughput_bps": 0.0,
}


def _number(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def data_source_for(settings: dict) -> str:
    return "simulated" if settings.get("mode", "demo") == "demo" else "live"


def _simulated_online(server: dict) -> bool:
    """Return the simulated target's own status, independent of heartbeats.

    Simulated targets are a fixed demonstration fleet rather than hosts that
    send heartbeats. On a serverless host there may be no long-running worker
    to refresh ``last_seen``, so demo status must not decay just because the
    process sat idle. The stored demo profile remains authoritative.
    """
    if (server.get("demo_baseline") or {}).get("offline"):
        return False
    return server.get("status", "healthy") != "offline"


def is_online(server: dict, settings: dict, now: datetime | None = None) -> bool:
    if server.get("data_source") == "simulated":
        return _simulated_online(server)
    now = now or utcnow()
    last_seen = parse_iso(server.get("last_seen"))
    return bool(last_seen and (now - last_seen).total_seconds() <= effective_offline_seconds(settings))


def availability_percent(server: dict, start: datetime, end: datetime) -> float:
    if server.get("data_source") == "simulated":
        return 100.0 if _simulated_online(server) else 0.0
    now = utcnow()
    last_seen = parse_iso(server.get("last_seen"))
    monitoring_since = parse_iso(server.get("monitoring_since") or server.get("registered_at"))
    effective_end = min(end, now)
    effective_start = max(start, monitoring_since) if monitoring_since else start
    total = max(1.0, (effective_end - effective_start).total_seconds())
    if not last_seen:
        return 0.0
    if (now - last_seen).total_seconds() <= 90:
        return 100.0
    outage_start = max(effective_start, last_seen)
    outage = max(0.0, (effective_end - outage_start).total_seconds())
    return round(max(0.0, min(100.0, (1 - outage / total) * 100)), 2)


def server_snapshot(server: dict, settings: dict, now: datetime | None = None) -> dict:
    now = now or utcnow()
    online = is_online(server, settings, now)
    latest = server.get("latest_metrics") or {}
    thresholds = settings.get("thresholds", {})
    status = server.get("status", "unknown")
    if not online:
        status = "offline"
    score = float(server.get("health_score") or 0)
    if not online:
        score = 0.0
    return {
        "id": server["id"],
        "name": server.get("name"),
        "hostname": server.get("hostname"),
        "ip_address": server.get("ip_address"),
        "os": server.get("os"),
        "resource_type": server.get("resource_type"),
        "provider": server.get("provider"),
        "region": server.get("region"),
        "environment": server.get("environment"),
        "status": status,
        "health_score": round(score, 1),
        "data_source": server.get("data_source", "simulated"),
        "simulated": server.get("data_source") == "simulated",
        "last_seen": server.get("last_seen"),
        "registered_at": server.get("registered_at"),
        "tags": server.get("tags", []),
        "cost_per_hour": server.get("cost_per_hour", 0),
        "latest_metrics": latest,
        "thresholds": thresholds,
    }


def load_rows(
    store,
    *,
    source: str,
    start_iso: str,
    end_iso: str,
    server_id: str | None = None,
    limit: int = 100000,
) -> list[dict]:
    query: dict = {
        "data_source": source,
        "timestamp": {"$gte": start_iso, "$lte": end_iso},
    }
    if server_id:
        query["server_id"] = server_id
    rows = store.find("telemetry", query, sort=[("timestamp", -1)], limit=limit)
    rows.reverse()
    return rows


def build_series(rows: list[dict], start: datetime, end: datetime, max_points: int = 60) -> list[dict]:
    duration = max(5, int((end - start).total_seconds()))
    bucket_seconds = max(5, min(3600, int(math.ceil(duration / max_points))))
    start_epoch = start.timestamp()
    buckets: dict[int, dict] = {}

    for row in rows:
        timestamp = parse_iso(row.get("timestamp"))
        if not timestamp:
            continue
        bucket_epoch = start_epoch + math.floor((timestamp.timestamp() - start_epoch) / bucket_seconds) * bucket_seconds
        bucket = buckets.setdefault(
            bucket_epoch,
            {
                "count": 0,
                "cpu_percent": 0.0,
                "memory_percent": 0.0,
                "disk_percent": 0.0,
                "response_time_ms": 0.0,
                "network_in_bps": 0.0,
                "network_out_bps": 0.0,
            },
        )
        bucket["count"] += 1
        bucket["cpu_percent"] += _number(row.get("cpu_percent"))
        bucket["memory_percent"] += _number(row.get("memory_percent"))
        bucket["disk_percent"] += _number(row.get("disk_percent"))
        bucket["response_time_ms"] += _number(row.get("response_time_ms"))
        bucket["network_in_bps"] += _number(row.get("network_in_bps"))
        bucket["network_out_bps"] += _number(row.get("network_out_bps"))

    series = []
    for bucket_epoch in sorted(buckets):
        bucket = buckets[bucket_epoch]
        count = max(1, bucket["count"])
        series.append(
            {
                "timestamp": iso(datetime.fromtimestamp(bucket_epoch, tz=timezone.utc)),
                "cpu_percent": round(bucket["cpu_percent"] / count, 2),
                "memory_percent": round(bucket["memory_percent"] / count, 2),
                "disk_percent": round(bucket["disk_percent"] / count, 2),
                "response_time_ms": round(bucket["response_time_ms"] / count, 1),
                "network_in_mbps": round(bucket["network_in_bps"] / count / 1_000_000, 3),
                "network_out_mbps": round(bucket["network_out_bps"] / count / 1_000_000, 3),
                "network_mbps": round((bucket["network_in_bps"] + bucket["network_out_bps"]) / count / 1_000_000, 3),
                "samples": bucket["count"],
            }
        )
    return series


def overview(store, settings: dict, range_info: dict) -> dict:
    now = utcnow()
    source = data_source_for(settings)
    all_servers = store.find("servers", {"data_source": source}, sort=[("name", 1)])
    snapshots = [server_snapshot(server, settings, now) for server in all_servers]
    online = [snapshot for snapshot in snapshots if snapshot["status"] != "offline"]
    offline = [snapshot for snapshot in snapshots if snapshot["status"] == "offline"]

    def average(field: str) -> float:
        values = [
            _number((snapshot.get("latest_metrics") or {}).get(field))
            for snapshot in online
            if (snapshot.get("latest_metrics") or {}).get(field) is not None
        ]
        return round(sum(values) / len(values), 2) if values else 0.0

    avg_cpu = average("cpu_percent")
    avg_memory = average("memory_percent")
    avg_disk = average("disk_percent")
    network_mbps = round(
        sum(_number((snapshot.get("latest_metrics") or {}).get("network_throughput_bps")) for snapshot in online) / 1_000_000,
        2,
    )
    response_time = average("response_time_ms")

    start, end = range_info["start"], range_info["end"]
    uptime_values = [availability_percent(server, start, end) for server in all_servers]
    uptime = round(sum(uptime_values) / len(uptime_values), 2) if uptime_values else 0.0

    rows = load_rows(
        store,
        source=source,
        start_iso=range_info["start_iso"],
        end_iso=range_info["end_iso"],
        limit=80000,
    )
    series = build_series(rows, start, end, max_points=60)

    def row_average(field: str, digits: int = 2) -> float | None:
        values = [_number(row.get(field)) for row in rows if row.get(field) is not None]
        return round(sum(values) / len(values), digits) if values else None

    # The KPI cards are labelled as averages for the selected window, so they
    # must come from the same telemetry rows as the trend chart. A single
    # latest sample can be an idle 0% CPU reading and contradict the chart.
    if rows:
        avg_cpu = row_average("cpu_percent") or 0.0
        avg_memory = row_average("memory_percent") or 0.0
        avg_disk = row_average("disk_percent") or 0.0
        response_time = row_average("response_time_ms", 1) or 0.0
        network_mbps = round(
            sum(_number(row.get("network_in_bps")) + _number(row.get("network_out_bps")) for row in rows)
            / len(rows)
            / 1_000_000,
            2,
        )

    active_alerts = store.find(
        "alerts",
        {"data_source": source, "status": {"$in": ["active", "acknowledged"]}},
        sort=[("created_at", -1)],
        limit=500,
    )
    alert_counts = alert_summary(active_alerts)
    anomalies_count = store.count(
        "anomalies",
        {"data_source": source, "timestamp": {"$gte": iso(now - timedelta(hours=24))}},
    )

    health_distribution = {"excellent": 0, "healthy": 0, "warning": 0, "critical": 0}
    for snapshot in snapshots:
        score = snapshot["health_score"]
        if score >= 90:
            health_distribution["excellent"] += 1
        elif score >= 75:
            health_distribution["healthy"] += 1
        elif score >= 50:
            health_distribution["warning"] += 1
        else:
            health_distribution["critical"] += 1

    costs = defaultdict(float)
    monthly_cost = 0.0
    for server in snapshots:
        hourly = float(server.get("cost_per_hour") or 0)
        monthly = hourly * 730
        monthly_cost += monthly
        costs[server.get("resource_type") or "Other"] += monthly

    return {
        "mode": settings.get("mode", "demo"),
        "data_source": source,
        "generated_at": iso(now),
        "range": {
            "label": range_info["label"],
            "start": range_info["start_iso"],
            "end": range_info["end_iso"],
            "seconds": range_info["seconds"],
        },
        "metrics": {
            "total_servers": len(snapshots),
            "active_servers": len(online),
            "offline_servers": len(offline),
            "cpu_percent": avg_cpu,
            "memory_percent": avg_memory,
            "disk_percent": avg_disk,
            "network_mbps": network_mbps,
            "response_time_ms": response_time,
            "uptime_percent": uptime,
            "active_alerts": len(active_alerts),
            "anomalies_24h": anomalies_count,
        },
        "alert_summary": alert_counts,
        "health_distribution": health_distribution,
        "series": series,
        "servers": snapshots,
        "top_servers": sorted(snapshots, key=lambda item: item["health_score"])[:5],
        "recent_alerts": active_alerts[:5],
        "costs": {
            "monthly_estimated": round(monthly_cost, 2),
            "by_type": [{"type": key, "monthly": round(value, 2)} for key, value in sorted(costs.items())],
        },
        "notes": {
            "uptime": "Average heartbeat availability for the selected window, derived from each server's last heartbeat.",
            "costs": "Estimated monthly run-rate based on configured per-hour costs. Not a cloud provider invoice.",
            "data_source": "Simulated demonstration telemetry" if source == "simulated" else "Live telemetry from registered hosts and agents",
        },
    }


def analytics(store, settings: dict, range_info: dict, *, server_id: str | None = None) -> dict:
    now = utcnow()
    source = data_source_for(settings)
    if server_id:
        servers = [item for item in store.find("servers", {"data_source": source}) if item["id"] == server_id]
    else:
        servers = store.find("servers", {"data_source": source}, sort=[("name", 1)])
    server_ids = {server["id"] for server in servers}

    rows = load_rows(
        store,
        source=source,
        start_iso=range_info["start_iso"],
        end_iso=range_info["end_iso"],
        server_id=server_id,
        limit=100000,
    )
    rows = [row for row in rows if row.get("server_id") in server_ids]
    start, end = range_info["start"], range_info["end"]
    series = build_series(rows, start, end, max_points=72)

    per_server: dict[str, dict] = {}
    for server in servers:
        per_server[server["id"]] = {
            "id": server["id"],
            "name": server.get("name"),
            "resource_type": server.get("resource_type"),
            "status": server_snapshot(server, settings, now)["status"],
            "health_score": server_snapshot(server, settings, now)["health_score"],
            "availability": availability_percent(server, start, end),
            "cpu_total": 0.0,
            "memory_total": 0.0,
            "disk_total": 0.0,
            "network_total": 0.0,
            "response_total": 0.0,
            "samples": 0,
        }

    daily: dict[str, dict] = {}
    for row in rows:
        server_bucket = per_server.get(row.get("server_id"))
        timestamp = parse_iso(row.get("timestamp"))
        if not server_bucket or not timestamp:
            continue
        server_bucket["cpu_total"] += _number(row.get("cpu_percent"))
        server_bucket["memory_total"] += _number(row.get("memory_percent"))
        server_bucket["disk_total"] += _number(row.get("disk_percent"))
        server_bucket["network_total"] += _number(row.get("network_throughput_bps")) / 1_000_000
        server_bucket["response_total"] += _number(row.get("response_time_ms"))
        server_bucket["samples"] += 1

        day_key = timestamp.date().isoformat()
        day = daily.setdefault(
            day_key,
            {
                "date": day_key,
                "cpu_total": 0.0,
                "memory_total": 0.0,
                "network_total": 0.0,
                "response_total": 0.0,
                "samples": 0,
            },
        )
        day["cpu_total"] += _number(row.get("cpu_percent"))
        day["memory_total"] += _number(row.get("memory_percent"))
        day["network_total"] += _number(row.get("network_throughput_bps")) / 1_000_000
        day["response_total"] += _number(row.get("response_time_ms"))
        day["samples"] += 1

    comparisons = []
    for bucket in per_server.values():
        samples = max(1, bucket["samples"])
        comparisons.append(
            {
                "id": bucket["id"],
                "name": bucket["name"],
                "resource_type": bucket["resource_type"],
                "status": bucket["status"],
                "health_score": bucket["health_score"],
                "availability": bucket["availability"],
                "cpu_percent": round(bucket["cpu_total"] / samples, 2),
                "memory_percent": round(bucket["memory_total"] / samples, 2),
                "disk_percent": round(bucket["disk_total"] / samples, 2),
                "network_mbps": round(bucket["network_total"] / samples, 2),
                "response_time_ms": round(bucket["response_total"] / samples, 1),
                "samples": bucket["samples"],
            }
        )

    daily_series = []
    for date_key in sorted(daily):
        day = daily[date_key]
        samples = max(1, day["samples"])
        daily_series.append(
            {
                "date": date_key,
                "cpu_percent": round(day["cpu_total"] / samples, 2),
                "memory_percent": round(day["memory_total"] / samples, 2),
                "network_mbps": round(day["network_total"] / samples, 2),
                "response_time_ms": round(day["response_total"] / samples, 1),
                "samples": day["samples"],
            }
        )

    availability = [
        {"id": item["id"], "name": item["name"], "availability": item["availability"], "status": item["status"]}
        for item in comparisons
    ]

    cost_breakdown = defaultdict(float)
    total_monthly = 0.0
    for server in servers:
        hourly = float(server.get("cost_per_hour") or 0)
        monthly = hourly * 730
        total_monthly += monthly
        cost_breakdown[server.get("resource_type") or "Other"] += monthly

    alerts = store.find(
        "alerts",
        {"data_source": source, "created_at": {"$gte": range_info["start_iso"], "$lte": range_info["end_iso"]}},
        sort=[("created_at", -1)],
        limit=2000,
    )
    anomalies = store.count(
        "anomalies",
        {"data_source": source, "timestamp": {"$gte": range_info["start_iso"], "$lte": range_info["end_iso"]}},
    )

    return {
        "mode": settings.get("mode", "demo"),
        "data_source": source,
        "range": {
            "label": range_info["label"],
            "start": range_info["start_iso"],
            "end": range_info["end_iso"],
            "seconds": range_info["seconds"],
        },
        "generated_at": iso(now),
        "series": series,
        "daily": daily_series,
        "availability": availability,
        "comparisons": sorted(comparisons, key=lambda item: item["name"] or ""),
        "top_consumers": sorted(comparisons, key=lambda item: item["cpu_percent"], reverse=True)[:5],
        "totals": {
            "samples": len(rows),
            "servers": len(servers),
            "alerts": len(alerts),
            "anomalies": anomalies,
            "avg_cpu": round(sum(item["cpu_percent"] for item in comparisons) / max(1, len(comparisons)), 2),
            "avg_memory": round(sum(item["memory_percent"] for item in comparisons) / max(1, len(comparisons)), 2),
            "avg_availability": round(
                sum(item["availability"] for item in comparisons) / max(1, len(comparisons)), 2
            ),
        },
        "costs": {
            "monthly_estimated": round(total_monthly, 2),
            "by_type": [{"type": key, "monthly": round(value, 2)} for key, value in sorted(cost_breakdown.items())],
            "note": "Estimated from configured hourly resource costs (730 hours/month).",
        },
        "notes": {
            "availability": "Current heartbeat availability across the selected window. Not an external uptime SLA.",
            "data_source": "Simulated demonstration data" if source == "simulated" else "Live agent telemetry",
        },
    }
