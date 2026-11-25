"""Monitored server / resource management endpoints."""
from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, abort, current_app, g, jsonify, request

from ..auth import admin_required, constant_time_compare, generate_agent_key, hash_agent_key, login_required
from ..services.alerts import alert_summary, evaluate_availability
from ..services.analytics import availability_percent, data_source_for, is_online, server_snapshot
from ..services.events import emit_event
from ..services.settings import get_settings
from ..utils import (
    ValidationError,
    bool_field,
    iso,
    new_id,
    number_field,
    parse_iso,
    parse_range,
    pagination,
    require_json,
    text_field,
    utcnow,
)

bp = Blueprint("servers", __name__, url_prefix="/api/servers")

RESOURCE_TYPES = {"Virtual Machine", "Storage", "Application", "Database", "Container", "Network", "Other"}
ENVIRONMENTS = {"production", "staging", "development", "testing"}


def _store():
    return current_app.extensions["cloudpulse_store"]


def _public_server(server: dict, settings: dict) -> dict:
    snapshot = server_snapshot(server, settings)
    snapshot["simulated"] = server.get("data_source") == "simulated"
    snapshot["is_local"] = bool(server.get("is_local"))
    snapshot["description"] = server.get("description", "")
    snapshot["agent_connected"] = bool(server.get("agent_key_hash")) and snapshot["status"] != "offline"
    return snapshot


def _agent_payload(server: dict, raw_key: str) -> dict:
    base = request.url_root.rstrip("/")
    ingest_url = f"{base}/api/telemetry/ingest"
    return {
        "key": raw_key,
        "ingest_url": ingest_url,
        "header": "X-Agent-Key",
        "command": (
            "python agent/cloudpulse_agent.py "
            f"--url {base} --key {raw_key}"
        ),
        "note": "Copy this key now. CloudPulse stores only a one-way hash and cannot show it again.",
    }


@bp.get("")
@login_required
def list_servers():
    store = _store()
    settings = get_settings(store)
    source_arg = request.args.get("source", "").strip()
    source = data_source_for(settings) if not source_arg or source_arg == "current" else source_arg
    query = {} if source == "all" else {"data_source": source}
    servers = store.find("servers", query, sort=[("name", 1)])
    snapshots = [_public_server(server, settings) for server in servers]

    status_filter = request.args.get("status", "").strip().lower()
    type_filter = request.args.get("type", "").strip().lower()
    search = request.args.get("q", "").strip().lower()
    if status_filter:
        snapshots = [item for item in snapshots if item["status"] == status_filter]
    if type_filter:
        snapshots = [item for item in snapshots if (item.get("resource_type") or "").lower() == type_filter]
    if search:
        snapshots = [
            item
            for item in snapshots
            if search
            in " ".join(
                str(item.get(field, ""))
                for field in ("name", "hostname", "ip_address", "os", "resource_type")
            ).lower()
        ]

    page, limit = pagination(request.args)
    total = len(snapshots)
    start = (page - 1) * limit
    items = snapshots[start:start + limit]

    status_counts = {"healthy": 0, "warning": 0, "critical": 0, "offline": 0}
    for item in snapshots:
        if item["status"] in status_counts:
            status_counts[item["status"]] += 1

    return jsonify(
        {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": max(1, (total + limit - 1) // limit),
            "status_counts": status_counts,
            "mode": settings.get("mode", "demo"),
            "data_source": source,
            "types": sorted({item.get("resource_type") for item in snapshots if item.get("resource_type")}),
        }
    )


def _create_live_server(payload: dict) -> tuple[dict, str]:
    store = _store()
    name = text_field(payload, "name", required_field=True, max_length=80, label="Server name")
    hostname = text_field(payload, "hostname", required_field=True, max_length=200, label="Hostname")
    if store.find_one("servers", {"hostname": hostname}):
        raise ValidationError("A monitoring target with this hostname already exists.", "hostname")
    resource_type = text_field(payload, "resource_type", max_length=40, default="Virtual Machine")
    if resource_type not in RESOURCE_TYPES:
        raise ValidationError("Unsupported resource type.", "resource_type")
    environment = text_field(payload, "environment", max_length=40, default="production").lower()
    if environment not in ENVIRONMENTS:
        environment = "production"
    tags = payload.get("tags") or []
    if isinstance(tags, str):
        tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
    if not isinstance(tags, list):
        tags = []
    tags = [str(tag)[:32] for tag in tags[:10]]
    cost = number_field(payload, "cost_per_hour", minimum=0, maximum=10000, default=0) or 0
    now = iso()
    server = {
        "id": new_id("srv_"),
        "name": name,
        "hostname": hostname,
        "ip_address": text_field(payload, "ip_address", max_length=64, default=""),
        "os": text_field(payload, "os", max_length=100, default="Unknown"),
        "resource_type": resource_type,
        "provider": text_field(payload, "provider", max_length=80, default="Self-managed"),
        "region": text_field(payload, "region", max_length=80, default="custom"),
        "environment": environment,
        "description": text_field(payload, "description", max_length=300, default=""),
        "tags": tags,
        "cost_per_hour": cost,
        "status": "offline",
        "health_score": 0,
        "data_source": "live",
        "simulated": False,
        "is_local": False,
        "agent_key_hash": None,
        "registered_at": now,
        "monitoring_since": now,
        "last_seen": None,
        "latest_metrics": None,
        "created_at": now,
        "updated_at": now,
    }
    raw_key, key_hash = generate_agent_key()
    server["agent_key_hash"] = key_hash
    server = store.insert("servers", server)
    return server, raw_key


@bp.post("")
@admin_required
def create_server():
    store = _store()
    server, raw_key = _create_live_server(require_json())
    emit_event("server:created", _public_server(server, get_settings(store)))
    return (
        jsonify(
            {
                "server": _public_server(server, get_settings(store)),
                "agent": _agent_payload(server, raw_key),
                "message": "Target created. Install the CloudPulse agent with the one-time key shown below.",
            }
        ),
        201,
    )


@bp.post("/register")
def register_agent():
    """Self-enrollment for remote agents using a shared bootstrap token."""
    expected = current_app.config.get("AGENT_ENROLLMENT_TOKEN")
    supplied = request.headers.get("X-Enrollment-Token", "")
    if not expected:
        raise ValidationError(
            "Agent self-enrollment is disabled. Set AGENT_ENROLLMENT_TOKEN on the API "
            "or create targets from the Infrastructure page.",
        )
    if not constant_time_compare(supplied, expected):
        from ..auth import AuthError

        raise AuthError("Invalid enrollment token.", 403)
    server, raw_key = _create_live_server(require_json())
    return (
        jsonify(
            {
                "server_id": server["id"],
                "server": _public_server(server, get_settings(_store())),
                "agent_key": raw_key,
                "ingest_url": request.url_root.rstrip("/") + "/api/telemetry/ingest",
            }
        ),
        201,
    )


@bp.get("/<server_id>")
@login_required
def get_server(server_id: str):
    store = _store()
    settings = get_settings(store)
    server = store.find_one("servers", {"id": server_id})
    if not server:
        abort(404, description="Server not found.")
    metrics = store.find(
        "telemetry",
        {"server_id": server_id},
        sort=[("timestamp", -1)],
        limit=240,
    )
    alerts = store.find(
        "alerts",
        {"server_id": server_id},
        sort=[("created_at", -1)],
        limit=20,
    )
    anomalies = store.find(
        "anomalies",
        {"server_id": server_id},
        sort=[("timestamp", -1)],
        limit=20,
    )
    now = utcnow()
    return jsonify(
        {
            "server": _public_server(server, settings),
            "metrics": list(reversed(metrics)),
            "alerts": alerts,
            "alert_summary": alert_summary(alerts),
            "anomalies": anomalies,
            "availability_24h": availability_percent(server, now - timedelta(hours=24), now),
            "data_source": server.get("data_source"),
        }
    )


@bp.get("/<server_id>/metrics")
@login_required
def server_metrics(server_id: str):
    store = _store()
    server = store.find_one("servers", {"id": server_id})
    if not server:
        abort(404, description="Server not found.")
    range_info = parse_range(request.args)
    page, limit = pagination(request.args)
    query = {
        "server_id": server_id,
        "timestamp": {"$gte": range_info["start_iso"], "$lte": range_info["end_iso"]},
    }
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
        }
    )


@bp.post("/<server_id>/check")
@login_required
def check_server(server_id: str):
    store = _store()
    settings = get_settings(store)
    server = store.find_one("servers", {"id": server_id})
    if not server:
        abort(404, description="Server not found.")
    evaluate_availability(store, server, settings)
    server = store.find_one("servers", {"id": server_id})
    snapshot = _public_server(server, settings)
    return jsonify(
        {
            "server": snapshot,
            "checked_at": iso(),
            "online": snapshot["status"] != "offline",
            "message": (
                "Heartbeat is current and the target is reachable."
                if snapshot["status"] != "offline"
                else "No recent heartbeat. Verify the host and agent process."
            ),
        }
    )


@bp.post("/<server_id>/rotate-key")
@admin_required
def rotate_agent_key(server_id: str):
    store = _store()
    server = store.find_one("servers", {"id": server_id})
    if not server:
        abort(404, description="Server not found.")
    if server.get("data_source") != "live":
        raise ValidationError("Only live monitoring targets use agent keys.")
    raw_key, key_hash = generate_agent_key()
    server["agent_key_hash"] = key_hash
    server["updated_at"] = iso()
    server = store.update("servers", {"id": server_id}, server)
    return jsonify({"server": _public_server(server, get_settings(store)), "agent": _agent_payload(server, raw_key)})


@bp.patch("/<server_id>")
@admin_required
def update_server(server_id: str):
    store = _store()
    server = store.find_one("servers", {"id": server_id})
    if not server:
        abort(404, description="Server not found.")
    data = require_json()
    if "name" in data:
        server["name"] = text_field(data, "name", required_field=True, max_length=80, label="Server name")
    if "description" in data:
        server["description"] = text_field(data, "description", max_length=300, default="")
    if "tags" in data:
        tags = data["tags"]
        if isinstance(tags, str):
            tags = [tag.strip() for tag in tags.split(",") if tag.strip()]
        if isinstance(tags, list):
            server["tags"] = [str(tag)[:32] for tag in tags[:10]]
    if "cost_per_hour" in data:
        server["cost_per_hour"] = number_field(data, "cost_per_hour", minimum=0, maximum=10000, default=0) or 0
    server["updated_at"] = iso()
    server = store.update("servers", {"id": server_id}, server)
    snapshot = _public_server(server, get_settings(store))
    emit_event("server:updated", snapshot)
    return jsonify({"server": snapshot})


@bp.delete("/<server_id>")
@admin_required
def delete_server(server_id: str):
    store = _store()
    server = store.find_one("servers", {"id": server_id})
    if not server:
        abort(404, description="Server not found.")
    if server.get("is_local"):
        raise ValidationError("The local collector target cannot be removed while live mode is active.")
    store.delete("telemetry", {"server_id": server_id})
    store.delete("alerts", {"server_id": server_id})
    store.delete("anomalies", {"server_id": server_id})
    store.delete("servers", {"id": server_id})
    emit_event("server:deleted", {"id": server_id, "name": server.get("name")})
    return jsonify({"message": f"{server.get('name')} and its historical telemetry were removed."})
