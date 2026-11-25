"""Analytics aggregation endpoint."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from ..auth import login_required
from ..services.analytics import analytics
from ..services.settings import get_settings
from ..utils import parse_range

bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")


@bp.get("")
@login_required
def analytics_view():
    store = current_app.extensions["cloudpulse_store"]
    settings = get_settings(store)
    range_info = parse_range(request.args)
    server_id = request.args.get("server_id", "").strip() or None
    if server_id:
        server = store.find_one("servers", {"id": server_id})
        if not server:
            server_id = None
    return jsonify(analytics(store, settings, range_info, server_id=server_id))
