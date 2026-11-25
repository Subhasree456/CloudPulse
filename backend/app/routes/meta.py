"""Health checks, API documentation and public metadata."""
from __future__ import annotations

import time

from flask import Blueprint, current_app, jsonify, request

from ..services.settings import get_settings
from ..utils import iso, utcnow

bp = Blueprint("meta", __name__, url_prefix="/api")
_started_at = time.time()


@bp.get("/health")
def health():
    store = current_app.extensions["cloudpulse_store"]
    database = store.health()
    settings = get_settings(store) if database["connected"] else {"mode": "unknown"}
    runtime = current_app.extensions.get("cloudpulse_runtime")
    status = "ok" if database["connected"] else "degraded"
    return (
        jsonify(
            {
                "status": status,
                "service": "cloudpulse-api",
                "version": current_app.config.get("API_VERSION", "1.0.0"),
                "environment": current_app.config.get("ENVIRONMENT", "development"),
                "timestamp": iso(),
                "uptime_seconds": int(time.time() - _started_at),
                "mode": settings.get("mode", "unknown"),
                "data_source": "simulated" if settings.get("mode") == "demo" else "live",
                "database": database,
                "workers": {
                    "running": bool(runtime and runtime.running),
                    "last_error": getattr(runtime, "last_error", None),
                },
            }
        ),
        200 if status == "ok" else 503,
    )


@bp.get("/meta")
def meta():
    return jsonify(
        {
            "name": "CloudPulse",
            "tagline": "Monitor. Analyse. Optimise.",
            "description": "Intelligent cloud infrastructure monitoring and analytics platform.",
            "version": current_app.config.get("API_VERSION", "1.0.0"),
            "docs": request.url_root.rstrip("/") + "/api/docs",
            "health": request.url_root.rstrip("/") + "/api/health",
        }
    )


@bp.get("/openapi.json")
def openapi():
    paths: dict[str, dict] = {}
    summaries = {
        "auth.register": "Register a user",
        "auth.login": "Sign in and receive a JWT",
        "auth.logout": "Revoke the current token",
        "auth.me": "Current user",
        "auth.update_profile": "Update the current profile",
        "auth.change_password": "Change password",
        "auth.list_users": "List users (admin)",
        "dashboard.dashboard_overview": "Dashboard overview metrics and charts",
        "servers.list_servers": "List monitored targets",
        "servers.create_server": "Create a live monitoring target",
        "servers.register_agent": "Self-enroll a remote agent",
        "servers.get_server": "Server detail and recent telemetry",
        "servers.server_metrics": "Paginated historical telemetry",
        "servers.check_server": "Run a heartbeat health check",
        "servers.rotate_agent_key": "Rotate an agent key",
        "servers.update_server": "Update a target",
        "servers.delete_server": "Remove a target and its history",
        "telemetry.ingest": "Ingest agent telemetry",
        "telemetry.heartbeat": "Send an agent heartbeat",
        "telemetry.history": "Telemetry history",
        "telemetry.latest": "Latest telemetry sample per server",
        "telemetry.validate_agent": "Validate an agent key",
        "alerts.list_alerts": "List alerts",
        "alerts.get_alert": "Alert detail",
        "alerts.acknowledge": "Acknowledge an alert",
        "alerts.resolve": "Resolve an alert",
        "alerts.summary": "Alert summary",
        "alerts.categories": "Alert categories",
        "anomalies.anomalies": "Anomaly history",
        "anomalies.detect": "Run Isolation Forest detection",
        "anomalies.runs": "Detection run history",
        "anomalies.timeline": "Anomaly timeline",
        "analytics.analytics_view": "Analytics aggregation",
        "reports.reports": "Generated report history",
        "reports.summary": "Report preview data",
        "reports.download_pdf": "Download a PDF report",
        "reports.export_csv": "Export telemetry as CSV",
        "settings.get_monitoring_settings": "Read monitoring settings",
        "settings.update_monitoring_settings": "Update settings and switch mode",
        "services.services": "Cloud service integration inventory",
        "meta.health": "Liveness and readiness probe",
        "meta.meta": "Public service metadata",
        "meta.openapi": "OpenAPI document",
    }
    for rule in current_app.url_map.iter_rules():
        if not str(rule).startswith("/api/") or rule.endpoint == "static":
            continue
        path = str(rule).replace("<", "{").replace(">", "}")
        if path in {"/api/docs", "/api/openapi.json"}:
            continue
        path_item = paths.setdefault(path, {})
        for method in rule.methods or []:
            if method in {"HEAD", "OPTIONS"}:
                continue
            operation = {
                "summary": summaries.get(rule.endpoint, rule.endpoint),
                "operationId": rule.endpoint.replace(".", "_"),
                "responses": {
                    "200": {"description": "Successful response"},
                    "400": {"description": "Invalid request"},
                    "401": {"description": "Authentication required"},
                    "403": {"description": "Administrator access required"},
                },
            }
            if any(token in str(rule) for token in ("<server_id>", "<alert_id>")):
                operation["parameters"] = [
                    {
                        "name": "server_id" if "server_id" in path else "alert_id",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    }
                ]
            path_item[method.lower()] = operation

    return jsonify(
        {
            "openapi": "3.0.3",
            "info": {
                "title": "CloudPulse API",
                "version": current_app.config.get("API_VERSION", "1.0.0"),
                "description": (
                    "Cloud infrastructure monitoring API. Authenticate with a bearer JWT for user "
                    "endpoints, or an X-Agent-Key header for telemetry ingestion. Demo data is always "
                    "labelled with data_source=simulated."
                ),
            },
            "servers": [{"url": request.url_root.rstrip("/")}],
            "components": {
                "securitySchemes": {
                    "BearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"},
                    "AgentKey": {"type": "apiKey", "in": "header", "name": "X-Agent-Key"},
                }
            },
            "security": [{"BearerAuth": []}],
            "paths": paths,
        }
    )


@bp.get("/docs")
def docs():
    html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CloudPulse API documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>
    body { margin: 0; background: #060b17; }
    .topbar { display: none; }
    .swagger-ui { font-family: Inter, system-ui, sans-serif; }
    .swagger-ui .info .title, .swagger-ui .info h1, .swagger-ui .info h2 { color: #e2e8f0; }
    .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .opblock-tag, .swagger-ui .opblock-summary-description { color: #cbd5e1; }
    .swagger-ui .scheme-container { background: #0b1220; box-shadow: none; }
    .swagger-ui .wrapper { max-width: 1180px; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>"""
    return current_app.response_class(html, mimetype="text/html")
