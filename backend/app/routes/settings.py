"""Global monitoring settings and mode switching."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from ..auth import admin_required, login_required
from ..services.events import emit_event
from ..services.runtime import average_api_latency_ms
from ..services.settings import (
    effective_offline_seconds,
    get_settings,
    validate_settings_payload,
)
from ..services.telemetry import collect_local_metrics, ensure_local_server, generate_demo_tick
from ..utils import iso, require_json

bp = Blueprint("settings", __name__, url_prefix="/api/settings")


def _store():
    return current_app.extensions["cloudpulse_store"]


def _payload(store, settings: dict) -> dict:
    runtime = current_app.extensions.get("cloudpulse_runtime")
    return {
        "settings": settings,
        "effective_offline_seconds": effective_offline_seconds(settings),
        "system": {
            "app": current_app.config.get("APP_NAME", "CloudPulse"),
            "version": current_app.config.get("API_VERSION", "1.0.0"),
            "environment": current_app.config.get("ENVIRONMENT", "development"),
            "database_backend": store.backend,
            "database_detail": store.backend_detail,
            "background_workers": bool(runtime and runtime.running),
            "local_collector_enabled": bool(current_app.config.get("ENABLE_LOCAL_COLLECTOR", True)),
            "agent_enrollment_enabled": bool(current_app.config.get("AGENT_ENROLLMENT_TOKEN")),
            "api_latency_ms": average_api_latency_ms(),
            "server_time": iso(),
        },
    }


@bp.get("")
@login_required
def get_monitoring_settings():
    store = _store()
    settings = get_settings(store)
    return jsonify(_payload(store, settings))


@bp.put("")
@admin_required
def update_monitoring_settings():
    store = _store()
    current = get_settings(store)
    payload = require_json()
    updated = validate_settings_payload(payload, current)
    previous_mode = current.get("mode")
    store.update("settings", {"id": "global"}, updated)

    actions = []
    if updated.get("mode") == "live" and current_app.config.get("ENABLE_LOCAL_COLLECTOR", True):
        try:
            server = ensure_local_server(store)
            collect_local_metrics(store, server, average_api_latency_ms())
            actions.append("Local collector started for this host.")
        except Exception as exc:  # noqa: BLE001
            current_app.logger.warning("Could not start local collector: %s", exc)
    elif updated.get("mode") == "demo":
        try:
            generated = generate_demo_tick(store, updated)
            if generated:
                actions.append(f"Generated {len(generated)} demo telemetry samples.")
        except Exception as exc:  # noqa: BLE001
            current_app.logger.warning("Could not generate demo sample: %s", exc)

    if updated.get("mode") != previous_mode:
        emit_event(
            "mode:changed",
            {
                "mode": updated.get("mode"),
                "data_source": "simulated" if updated.get("mode") == "demo" else "live",
                "changed_by": g.current_user.get("name"),
                "changed_at": iso(),
            },
        )
    emit_event(
        "settings:updated",
        {
            "mode": updated.get("mode"),
            "monitoring_interval_seconds": updated.get("monitoring_interval_seconds"),
            "thresholds": updated.get("thresholds"),
            "updated_at": updated.get("updated_at"),
            "updated_by": g.current_user.get("name"),
        },
    )
    return jsonify(
        {
            **_payload(store, updated),
            "message": "Monitoring configuration saved."
            + (" " + " ".join(actions) if actions else ""),
        }
    )
