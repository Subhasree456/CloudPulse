"""Dashboard overview aggregation."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from ..auth import login_required
from ..services.analytics import overview
from ..services.settings import get_settings
from ..utils import parse_range

bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")


@bp.get("/overview")
@login_required
def dashboard_overview():
    store = current_app.extensions["cloudpulse_store"]
    settings = get_settings(store)
    range_info = parse_range(request.args)
    return jsonify(overview(store, settings, range_info))
