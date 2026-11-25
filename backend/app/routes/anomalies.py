"""Anomaly detection and anomaly history endpoints."""
from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, current_app, jsonify, request

from ..auth import admin_required, login_required
from ..services.anomalies import detect_and_store, list_anomalies
from ..services.analytics import data_source_for
from ..services.settings import get_settings
from ..utils import iso, parse_range, utcnow

bp = Blueprint("anomalies", __name__, url_prefix="/api/anomalies")


def _store():
    return current_app.extensions["cloudpulse_store"]


@bp.get("")
@login_required
def anomalies():
    store = _store()
    settings = get_settings(store)
    source = request.args.get("source") or data_source_for(settings)
    server_id = request.args.get("server_id", "").strip() or None
    severity = request.args.get("severity", "").strip() or None
    range_info = parse_range(request.args)
    items = list_anomalies(
        store,
        data_source=None if source == "all" else source,
        server_id=server_id,
        start=range_info["start_iso"],
        end=range_info["end_iso"],
        severity=severity,
        limit=300,
    )
    summary = {"total": len(items), "critical": 0, "warning": 0, "servers": set()}
    for item in items:
        if item.get("severity") == "critical":
            summary["critical"] += 1
        elif item.get("severity") == "warning":
            summary["warning"] += 1
        summary["servers"].add(item.get("server_id"))
    summary["servers"] = len(summary["servers"])
    latest_run = store.find_one("detection_runs", {"data_source": source}, sort=[("run_at", -1)])
    if not latest_run and source != "all":
        latest_run = store.find_one("detection_runs", {}, sort=[("run_at", -1)])
    runs = store.find("detection_runs", {}, sort=[("run_at", -1)], limit=8)

    servers = store.find("servers", {} if source == "all" else {"data_source": source}, sort=[("name", 1)])
    return jsonify(
        {
            "items": items,
            "summary": summary,
            "latest_run": latest_run,
            "runs": runs,
            "servers": [{"id": item["id"], "name": item.get("name")} for item in servers],
            "data_source": source,
            "range": {
                "label": range_info["label"],
                "start": range_info["start_iso"],
                "end": range_info["end_iso"],
            },
            "minimum_points": 40,
            "message": (
                "No anomalies detected in this window."
                if items
                else "No anomalies recorded yet. Run detection once enough telemetry has been collected."
            ),
        }
    )


@bp.post("/detect")
@admin_required
def detect():
    store = _store()
    settings = get_settings(store)
    payload = request.get_json(silent=True) or {}
    source = payload.get("data_source")
    if source not in {None, "simulated", "live"}:
        source = None
    result = detect_and_store(
        store,
        settings,
        data_source=source,
        triggered_by="manual",
        emit=True,
    )
    return jsonify(
        {
            "run": result,
            "message": result.get("message", "Anomaly detection completed."),
        }
    )


@bp.get("/runs")
@login_required
def runs():
    store = _store()
    items = store.find("detection_runs", {}, sort=[("run_at", -1)], limit=20)
    return jsonify({"items": items, "total": len(items)})


@bp.get("/timeline")
@login_required
def timeline():
    store = _store()
    settings = get_settings(store)
    source = data_source_for(settings)
    since = iso(utcnow() - timedelta(days=7))
    items = list_anomalies(store, data_source=source, start=since, limit=400)
    buckets: dict[str, dict] = {}
    for item in items:
        day = str(item.get("timestamp", ""))[:10]
        bucket = buckets.setdefault(day, {"date": day, "warning": 0, "critical": 0, "total": 0})
        bucket["total"] += 1
        severity = item.get("severity")
        if severity in {"warning", "critical"}:
            bucket[severity] += 1
    return jsonify({"items": [buckets[key] for key in sorted(buckets)], "data_source": source})
