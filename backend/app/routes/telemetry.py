"""Agent telemetry ingestion and historical telemetry queries."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from ..auth import AuthError, hash_agent_key, login_required
from ..services.alerts import evaluate_availability
from ..services.settings import get_settings
from ..services.telemetry import record_telemetry
from ..utils import (
    ValidationError,
    iso,
    number_field,
    pagination,
    parse_range,
    require_json,
    utcnow,
)

bp = Blueprint("telemetry", __name__, url_prefix="/api/telemetry")


def _store():
    return current_app.extensions["cloudpulse_store"]


def _agent_server():
    raw_key = request.headers.get("X-Agent-Key", "").strip()
    if not raw_key:
        raise AuthError("X-Agent-Key header is required.", 401)
    store = _store()
    server = store.find_one("servers", {"agent_key_hash": hash_agent_key(raw_key)})
    if not server:
        raise AuthError("Invalid agent key.", 401)
    if server.get("data_source") != "live":
        raise AuthError("This key does not belong to a live monitoring target.", 403)
    return store, server


@bp.post("/ingest")
def ingest():
    store, server = _agent_server()
    payload = require_json()
    cpu = number_field(payload, "cpu_percent", minimum=0, maximum=100, required_field=True)
    memory = number_field(payload, "memory_percent", minimum=0, maximum=100, required_field=True)
    disk = number_field(payload, "disk_percent", minimum=0, maximum=100, required_field=True)
    network_in_bps = number_field(payload, "network_in_bps", minimum=0, default=0) or 0
    network_out_bps = number_field(payload, "network_out_bps", minimum=0, default=0) or 0
    response_time = number_field(payload, "response_time_ms", minimum=0, maximum=600000, default=0) or 0
    memory_total = number_field(payload, "memory_total_mb", minimum=0, default=0) or 0
    memory_available = number_field(
        payload,
        "memory_available_mb",
        minimum=0,
        default=memory_total * (1 - (memory or 0) / 100),
    ) or 0
    uptime = number_field(payload, "uptime_seconds", minimum=0, default=0) or 0
    load = number_field(payload, "load_average", minimum=0, default=0) or 0

    metrics = {
        "cpu_percent": cpu,
        "memory_percent": memory,
        "disk_percent": disk,
        "network_in_bps": int(network_in_bps),
        "network_out_bps": int(network_out_bps),
        "response_time_ms": response_time,
        "memory_total_mb": memory_total,
        "memory_available_mb": memory_available,
        "uptime_seconds": int(uptime),
        "load_average": load,
    }
    metric = record_telemetry(
        store,
        server,
        metrics,
        get_settings(store),
        timestamp=utcnow(),
        data_source="live",
    )
    updated_server = store.find_one("servers", {"id": server["id"]})
    return (
        jsonify(
            {
                "message": "Telemetry accepted.",
                "metric": metric,
                "server": {
                    "id": updated_server["id"],
                    "name": updated_server.get("name"),
                    "status": updated_server.get("status"),
                    "health_score": updated_server.get("health_score"),
                    "last_seen": updated_server.get("last_seen"),
                },
            }
        ),
        201,
    )


@bp.post("/heartbeat")
def heartbeat():
    store, server = _agent_server()
    now = utcnow()
    server["last_seen"] = iso(now)
    server["updated_at"] = iso(now)
    if server.get("status") == "offline":
        server["status"] = "healthy"
    server = store.update("servers", {"id": server["id"]}, server)
    settings = get_settings(store)
    evaluate_availability(store, server, settings)
    return jsonify({"message": "Heartbeat recorded.", "last_seen": server["last_seen"]})


@bp.get("/history")
@login_required
def history():
    store = _store()
    range_info = parse_range(request.args)
    page, limit = pagination(request.args)
    server_id = request.args.get("server_id", "").strip()
    source = request.args.get("source", "").strip()
    settings = get_settings(store)
    if not source:
        source = "simulated" if settings.get("mode", "demo") == "demo" else "live"
    query: dict = {
        "timestamp": {"$gte": range_info["start_iso"], "$lte": range_info["end_iso"]},
    }
    if server_id:
        query["server_id"] = server_id
    if source != "all":
        query["data_source"] = source
    total = store.count("telemetry", query)
    items = store.find(
        "telemetry",
        query,
        sort=[("timestamp", -1)],
        limit=limit,
        skip=(page - 1) * limit,
    )
    return jsonify(
        {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": max(1, (total + limit - 1) // limit),
            "range": {
                "label": range_info["label"],
                "start": range_info["start_iso"],
                "end": range_info["end_iso"],
            },
            "data_source": source,
        }
    )


@bp.get("/latest")
@login_required
def latest():
    store = _store()
    settings = get_settings(store)
    source = request.args.get("source") or ("simulated" if settings.get("mode", "demo") == "demo" else "live")
    servers = store.find("servers", {"data_source": source}, sort=[("name", 1)])
    items = []
    for server in servers:
        latest = store.find_one("telemetry", {"server_id": server["id"]}, sort=[("timestamp", -1)])
        if latest:
            items.append(latest)
    return jsonify({"items": items, "data_source": source, "count": len(items)})


@bp.get("/validate")
def validate_agent():
    store, server = _agent_server()
    return jsonify(
        {
            "valid": True,
            "server_id": server["id"],
            "server_name": server.get("name"),
            "interval_hint_seconds": get_settings(store).get("monitoring_interval_seconds", 5),
        }
    )
