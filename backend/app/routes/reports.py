"""Report preview, PDF and CSV download endpoints."""
from __future__ import annotations

import io
import re

from flask import Blueprint, current_app, g, jsonify, request, send_file
from flask import Response

from ..auth import login_required
from ..services.reports import (
    build_report_data,
    generate_pdf,
    list_reports,
    record_report,
    telemetry_csv,
)
from ..services.settings import get_settings
from ..utils import ValidationError, parse_range

bp = Blueprint("reports", __name__, url_prefix="/api/reports")


def _store():
    return current_app.extensions["cloudpulse_store"]


def _report_type() -> str:
    report_type = (request.args.get("type") or "daily").strip().lower()
    if report_type not in {"daily", "weekly"}:
        raise ValidationError("Report type must be daily or weekly.")
    return report_type


def _source():
    source = (request.args.get("source") or "").strip()
    return source if source in {"simulated", "live"} else None


@bp.get("")
@login_required
def reports():
    store = _store()
    items = list_reports(store, limit=30)
    return jsonify({"items": items, "total": len(items)})


@bp.get("/summary")
@login_required
def summary():
    store = _store()
    settings = get_settings(store)
    try:
        report = build_report_data(
            store,
            settings,
            report_type=_report_type(),
            date_value=request.args.get("date"),
            source=_source(),
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from None
    return jsonify(report)


@bp.get("/pdf")
@login_required
def download_pdf():
    store = _store()
    settings = get_settings(store)
    try:
        report = build_report_data(
            store,
            settings,
            report_type=_report_type(),
            date_value=request.args.get("date"),
            source=_source(),
        )
    except ValueError as exc:
        raise ValidationError(str(exc)) from None
    pdf = generate_pdf(report)
    record = record_report(
        store,
        report,
        created_by=g.current_user.get("name") or g.current_user.get("email"),
        file_format="pdf",
    )
    safe_period = re.sub(r"[^0-9a-zA-Z._-]+", "-", report["period"])
    filename = f"cloudpulse-{report['type']}-{safe_period}.pdf"
    response = send_file(
        io.BytesIO(pdf),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
        max_age=0,
    )
    response.headers["X-Report-Id"] = record["id"]
    return response


@bp.get("/export")
@login_required
def export_csv():
    store = _store()
    settings = get_settings(store)
    dataset = (request.args.get("dataset") or "telemetry").strip().lower()
    if dataset != "telemetry":
        raise ValidationError("Only the telemetry dataset is supported for CSV export.")
    range_info = parse_range(request.args)
    server_id = request.args.get("server_id", "").strip() or None
    content = telemetry_csv(store, settings, range_info, server_id=server_id)
    filename = f"cloudpulse-telemetry-{range_info['label']}.csv"
    response = Response("\ufeff" + content, mimetype="text/csv; charset=utf-8")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Cache-Control"] = "no-store"
    return response
