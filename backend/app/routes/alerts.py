"""Alert listing and lifecycle endpoints."""
from __future__ import annotations

from flask import Blueprint, current_app, g, jsonify, request

from ..auth import admin_required, login_required
from ..services.alerts import (
    acknowledge_alert,
    alert_summary,
    resolve_alert,
)
from ..services.analytics import data_source_for
from ..services.settings import get_settings
from ..utils import ValidationError, pagination, require_json
from flask import abort

bp = Blueprint("alerts", __name__, url_prefix="/api/alerts")


def _store():
    return current_app.extensions["cloudpulse_store"]


def _source(settings) -> str:
    requested = request.args.get("source", "").strip()
    if requested == "all":
        return "all"
    return requested or data_source_for(settings)


@bp.get("")
@login_required
def list_alerts():
    store = _store()
    settings = get_settings(store)
    source = _source(settings)
    page, limit = pagination(request.args)
    query: dict = {}
    if source != "all":
        query["data_source"] = source
    status = request.args.get("status", "").strip().lower()
    severity = request.args.get("severity", "").strip().lower()
    category = request.args.get("category", "").strip().lower()
    server_id = request.args.get("server_id", "").strip()
    if status:
        if status not in {"active", "acknowledged", "resolved"}:
            raise ValidationError("status must be active, acknowledged or resolved.")
        query["status"] = status
    if severity:
        if severity not in {"warning", "critical"}:
            raise ValidationError("severity must be warning or critical.")
        query["severity"] = severity
    if category:
        query["category"] = category
    if server_id:
        query["server_id"] = server_id

    total = store.count("alerts", query)
    items = store.find(
        "alerts",
        query,
        sort=[("created_at", -1)],
        limit=limit,
        skip=(page - 1) * limit,
    )
    summary_items = store.find("alerts", {k: v for k, v in query.items() if k in {"data_source"}}, limit=5000)
    return jsonify(
        {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "pages": max(1, (total + limit - 1) // limit),
            "summary": alert_summary(summary_items),
            "data_source": source,
        }
    )


@bp.get("/<alert_id>")
@login_required
def get_alert(alert_id: str):
    alert = _store().find_one("alerts", {"id": alert_id})
    if not alert:
        abort(404, description="Alert not found.")
    return jsonify({"alert": alert})


@bp.post("/<alert_id>/acknowledge")
@admin_required
def acknowledge(alert_id: str):
    store = _store()
    alert = store.find_one("alerts", {"id": alert_id})
    if not alert:
        abort(404, description="Alert not found.")
    if alert.get("status") == "resolved":
        raise ValidationError("A resolved alert cannot be acknowledged.")
    updated = acknowledge_alert(store, alert, g.current_user)
    return jsonify({"alert": updated, "message": f"Alert acknowledged by {g.current_user.get('name')}."})


@bp.post("/<alert_id>/resolve")
@admin_required
def resolve(alert_id: str):
    store = _store()
    alert = store.find_one("alerts", {"id": alert_id})
    if not alert:
        abort(404, description="Alert not found.")
    if alert.get("status") == "resolved":
        return jsonify({"alert": alert, "message": "Alert is already resolved."})
    payload = request.get_json(silent=True) or {}
    reason = str(payload.get("reason", "")).strip()[:500]
    updated = resolve_alert(
        store,
        alert_id,
        resolved_by=g.current_user.get("name") or g.current_user.get("email"),
        reason=reason,
    )
    return jsonify({"alert": updated, "message": "Alert resolved."})


@bp.get("/summary/current")
@login_required
def summary():
    store = _store()
    settings = get_settings(store)
    source = _source(settings)
    query = {} if source == "all" else {"data_source": source}
    alerts = store.find("alerts", query, limit=5000)
    return jsonify({"summary": alert_summary(alerts), "data_source": source})


@bp.get("/categories/list")
@login_required
def categories():
    from ..services.alerts import CATEGORY_LABELS

    return jsonify({"items": [{"id": key, "label": value} for key, value in CATEGORY_LABELS.items()]})
