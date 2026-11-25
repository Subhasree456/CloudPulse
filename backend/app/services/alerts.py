"""Threshold alert engine with de-duplication and lifecycle actions."""
from __future__ import annotations

from datetime import timedelta

from ..utils import iso, new_id, parse_iso, utcnow
from .events import emit_event
from .settings import effective_offline_seconds
from .health import status_from_metrics

SEVERITY_RANK = {"warning": 1, "critical": 2}

CATEGORY_LABELS = {
    "cpu": "CPU utilisation",
    "memory": "Memory utilisation",
    "disk": "Disk utilisation",
    "network": "Network throughput",
    "response_time": "Application response time",
    "availability": "Server availability",
}

RECOMMENDED_ACTIONS = {
    "cpu": "Inspect the busiest processes on this host, check for runaway workloads and consider adding compute capacity.",
    "memory": "Review memory-heavy processes, investigate leaks and consider increasing the instance memory allocation.",
    "disk": "Remove stale data, rotate logs and expand the volume before it reaches capacity.",
    "network": "Check traffic sources and egress destinations for unexpected load or a possible data transfer surge.",
    "response_time": "Profile the application, check database latency and review dependency health.",
    "availability": "Verify the host is powered on and reachable, then confirm the CloudPulse agent is running.",
}

UNITS = {
    "cpu": "%",
    "memory": "%",
    "disk": "%",
    "network": "Mbps",
    "response_time": "ms",
    "availability": "heartbeat",
}


def _active_alert(store, server_id: str, category: str) -> dict | None:
    return store.find_one(
        "alerts",
        {
            "server_id": server_id,
            "category": category,
            "status": {"$in": ["active", "acknowledged"]},
        },
        sort=[("created_at", -1)],
    )


def _metric_value(metrics: dict, category: str) -> float | None:
    if category == "cpu":
        return metrics.get("cpu_percent")
    if category == "memory":
        return metrics.get("memory_percent")
    if category == "disk":
        return metrics.get("disk_percent")
    if category == "network":
        bps = metrics.get("network_throughput_bps")
        return round(float(bps) / 1_000_000, 2) if bps is not None else None
    if category == "response_time":
        return metrics.get("response_time_ms")
    return None


def create_alert(
    store,
    server: dict,
    category: str,
    severity: str,
    description: str,
    *,
    metric_value: float | None = None,
    threshold: float | None = None,
    emit: bool = True,
) -> dict:
    now = iso()
    label = CATEGORY_LABELS.get(category, category)
    title = f"{label} {'critical' if severity == 'critical' else 'warning'} on {server.get('name')}"
    alert = {
        "id": new_id("alert_"),
        "server_id": server.get("id"),
        "server_name": server.get("name"),
        "server_status": server.get("status"),
        "category": category,
        "severity": severity,
        "title": title,
        "description": description,
        "recommended_action": RECOMMENDED_ACTIONS.get(category, "Investigate the condition and review recent telemetry."),
        "metric_value": metric_value,
        "metric_unit": UNITS.get(category, ""),
        "threshold": threshold,
        "status": "active",
        "data_source": server.get("data_source", "simulated"),
        "created_at": now,
        "updated_at": now,
        "acknowledged_at": None,
        "acknowledged_by": None,
        "resolved_at": None,
        "resolved_by": None,
        "resolution_reason": None,
    }
    store.insert("alerts", alert)
    if emit:
        emit_event("alert:new", alert)
    return alert


def raise_threshold_alert(
    store,
    server: dict,
    category: str,
    severity: str,
    value: float,
    threshold: float,
    unit: str,
    *,
    emit: bool = True,
) -> dict | None:
    """Create one alert per active condition. Escalate existing alerts instead
    of inserting duplicates."""
    existing = _active_alert(store, server["id"], category)
    label = CATEGORY_LABELS.get(category, category)
    description = (
        f"{label} on {server.get('name')} is {value:g}{unit}, which exceeds the "
        f"{severity} threshold of {threshold:g}{unit}."
    )
    if existing:
        if SEVERITY_RANK.get(severity, 0) > SEVERITY_RANK.get(existing.get("severity"), 0):
            existing.update(
                {
                    "severity": severity,
                    "title": f"{label} critical on {server.get('name')}",
                    "description": description,
                    "metric_value": value,
                    "threshold": threshold,
                    "status": "active",
                    "acknowledged_at": None,
                    "acknowledged_by": None,
                    "updated_at": iso(),
                }
            )
            updated = store.update("alerts", {"id": existing["id"]}, existing)
            if emit and updated:
                emit_event("alert:updated", updated)
            return updated
        return None

    return create_alert(
        store,
        server,
        category,
        severity,
        description,
        metric_value=value,
        threshold=threshold,
        emit=emit,
    )


def evaluate_metrics(store, server: dict, metrics: dict, settings: dict, *, emit: bool = True) -> list[dict]:
    thresholds = settings.get("thresholds", {})
    produced = []
    for category in ("cpu", "memory", "disk", "response_time", "network"):
        limits = thresholds.get(category, {})
        warning = limits.get("warning")
        critical = limits.get("critical")
        value = _metric_value(metrics, category)
        if value is None or warning is None or critical is None:
            continue
        severity = None
        threshold = None
        if value >= critical:
            severity = "critical"
            threshold = critical
        elif value >= warning:
            severity = "warning"
            threshold = warning
        if severity:
            alert = raise_threshold_alert(
                store,
                server,
                category,
                severity,
                float(value),
                float(threshold),
                UNITS.get(category, ""),
                emit=emit,
            )
            if alert:
                produced.append(alert)
    return produced


def evaluate_availability(store, server: dict, settings: dict, *, now=None, emit: bool = True) -> dict | None:
    now = now or utcnow()
    offline_after = effective_offline_seconds(settings)
    last_seen = parse_iso(server.get("last_seen"))
    online = bool(last_seen and (now - last_seen) <= timedelta(seconds=offline_after))

    if not online:
        existing = _active_alert(store, server["id"], "availability")
        if not existing:
            stale_for = int((now - last_seen).total_seconds()) if last_seen else None
            description = (
                f"No heartbeat has been received from {server.get('name')} for "
                f"{stale_for} seconds (expected within {offline_after} seconds)."
                if stale_for
                else f"{server.get('name')} has never sent a heartbeat."
            )
            alert = create_alert(
                store,
                server,
                "availability",
                "critical",
                description,
                metric_value=stale_for,
                threshold=offline_after,
                emit=emit,
            )
            if server.get("status") != "offline":
                server["status"] = "offline"
                server["health_score"] = 0
                server["updated_at"] = iso()
                store.update("servers", {"id": server["id"]}, server)
                if emit:
                    emit_event("server:updated", server)
            return alert
        return None

    # The host is back: close any active availability alert.
    existing = _active_alert(store, server["id"], "availability")
    if existing and settings.get("auto_resolve_availability", True):
        resolved = resolve_alert(
            store,
            existing["id"],
            resolved_by="auto-recovery",
            reason="Heartbeat restored; the availability alert was closed automatically.",
            emit=emit,
        )
        if server.get("status") == "offline":
            server["status"] = status_from_metrics(
                (server.get("latest_metrics") or {}).get("cpu_percent"),
                (server.get("latest_metrics") or {}).get("memory_percent"),
                (server.get("latest_metrics") or {}).get("disk_percent"),
                (server.get("latest_metrics") or {}).get("response_time_ms"),
                settings.get("thresholds", {}),
            )
            store.update("servers", {"id": server["id"]}, server)
            if emit:
                emit_event("server:updated", server)
        return resolved
    return None


def acknowledge_alert(store, alert: dict, user: dict) -> dict:
    if alert.get("status") == "resolved":
        return alert
    alert.update(
        {
            "status": "acknowledged",
            "acknowledged_at": iso(),
            "acknowledged_by": user.get("name") or user.get("email"),
            "updated_at": iso(),
        }
    )
    updated = store.update("alerts", {"id": alert["id"]}, alert)
    if updated:
        emit_event("alert:updated", updated)
    return updated or alert


def resolve_alert(
    store,
    alert_id: str,
    *,
    resolved_by: str,
    reason: str = "",
    emit: bool = True,
) -> dict | None:
    alert = store.find_one("alerts", {"id": alert_id})
    if not alert:
        return None
    if alert.get("status") != "resolved":
        alert.update(
            {
                "status": "resolved",
                "resolved_at": iso(),
                "resolved_by": resolved_by,
                "resolution_reason": reason or "Resolved manually.",
                "updated_at": iso(),
            }
        )
        alert = store.update("alerts", {"id": alert_id}, alert)
        if alert and emit:
            emit_event("alert:updated", alert)
    return alert


def alert_summary(alerts: list[dict]) -> dict:
    summary = {
        "total": len(alerts),
        "active": 0,
        "acknowledged": 0,
        "resolved": 0,
        "critical": 0,
        "warning": 0,
    }
    for alert in alerts:
        status = alert.get("status")
        if status in summary:
            summary[status] += 1
        if alert.get("severity") in summary and status != "resolved":
            summary[alert["severity"]] += 1
    return summary
