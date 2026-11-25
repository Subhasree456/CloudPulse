"""Honest cloud service integration inventory."""
from __future__ import annotations

from flask import Blueprint, current_app, jsonify

from ..auth import login_required
from ..services.settings import get_settings
from ..utils import iso, utcnow

bp = Blueprint("services", __name__, url_prefix="/api/services")


@bp.get("")
@login_required
def services():
    store = current_app.extensions["cloudpulse_store"]
    settings = get_settings(store)
    health = store.health()
    live_servers = store.find("servers", {"data_source": "live"})
    demo_servers = store.find("servers", {"data_source": "simulated"})
    live_agents = [server for server in live_servers if server.get("agent_key_hash")]
    runtime = current_app.extensions.get("cloudpulse_runtime")
    workers_running = bool(runtime and runtime.running)
    mongo_connected = health["backend"] == "mongodb" and health["connected"]
    demo_mode = settings.get("mode", "demo") == "demo"

    def item(name, detail, status, kind, verified):
        return {
            "name": name,
            "detail": detail,
            "status": status,
            "kind": kind,
            "verified": verified,
        }

    categories = [
        {
            "id": "iaas",
            "acronym": "IaaS",
            "name": "Infrastructure as a Service",
            "description": "Compute, virtual machines and host-level resource telemetry.",
            "icon": "server",
            "status": "live" if live_servers else ("simulated" if demo_servers else "not_configured"),
            "items": [
                item(
                    "Monitored compute targets",
                    f"{len(live_servers)} live agent target(s); {len(demo_servers)} clearly-labelled demo target(s).",
                    "Operational" if live_servers else "Demo only",
                    "actual" if live_servers else "simulated",
                    bool(live_servers),
                ),
                item(
                    "Host telemetry (CPU, memory, disk, network)",
                    "Collected by the Python agent using psutil over the CloudPulse ingest API."
                    if live_servers
                    else "No live agent is reporting. Switch to Live mode and run an agent to see real measurements.",
                    "Collecting" if live_servers else "Awaiting agent",
                    "actual" if live_servers else "conceptual",
                    bool(live_servers),
                ),
                item(
                    "AWS / Azure / GCP provider APIs",
                    "No cloud provider credentials are configured. CloudPulse does not claim to monitor provider accounts directly.",
                    "Not connected",
                    "conceptual",
                    False,
                ),
            ],
        },
        {
            "id": "paas",
            "acronym": "PaaS",
            "name": "Platform as a Service",
            "description": "Application hosting, background workers and deployment status.",
            "icon": "layers",
            "status": "live",
            "items": [
                item(
                    "CloudPulse Flask API",
                    f"Running in the {current_app.config.get('ENVIRONMENT', 'development')} environment.",
                    "Operational",
                    "actual",
                    True,
                ),
                item(
                    "Background collection & alert workers",
                    "Telemetry generator/collector, availability watchdog and anomaly scheduler."
                    if workers_running
                    else "Workers are disabled by configuration.",
                    "Operational" if workers_running else "Disabled",
                    "actual" if workers_running else "configuration",
                    workers_running,
                ),
                item(
                    "Render deployment",
                    "render.yaml and production start command are included. Live deployment has not been claimed.",
                    "Configuration ready",
                    "configuration",
                    False,
                ),
            ],
        },
        {
            "id": "saas",
            "acronym": "SaaS",
            "name": "Software as a Service",
            "description": "The CloudPulse monitoring product itself.",
            "icon": "cloud",
            "status": "live",
            "items": [
                item(
                    "CloudPulse monitoring dashboard",
                    "React dashboard with real-time charts, alerts, analytics, anomalies and reports.",
                    "Operational",
                    "actual",
                    True,
                ),
                item(
                    "Authentication and role-based access",
                    "JWT sessions, password hashing, admin and viewer roles, protected routes and APIs.",
                    "Enabled",
                    "actual",
                    True,
                ),
                item(
                    "CloudPulse agent download portal",
                    "The agent script ships in the repository; a hosted installer portal is not implemented.",
                    "Not implemented",
                    "conceptual",
                    False,
                ),
            ],
        },
        {
            "id": "dbaas",
            "acronym": "DBaaS",
            "name": "Database as a Service",
            "description": "Persistence for users, servers, telemetry, alerts and anomalies.",
            "icon": "database",
            "status": "live",
            "items": [
                item(
                    "MongoDB Atlas",
                    f"Connected to database '{current_app.config.get('MONGO_DB')}'."
                    if mongo_connected
                    else "Not configured. Set MONGO_URI to use MongoDB Atlas; CloudPulse is using its local fallback.",
                    "Connected" if mongo_connected else "Not configured",
                    "actual" if mongo_connected else "fallback",
                    mongo_connected,
                ),
                item(
                    "SQLite document fallback",
                    "Local, zero-dependency persistence used automatically when MongoDB is unavailable.",
                    "Active" if health["backend"] == "sqlite" else "Standby",
                    "fallback",
                    health["backend"] == "sqlite",
                ),
                item(
                    "Indexed telemetry queries",
                    "Indexes exist for server/time telemetry access; historical reads are paginated.",
                    "Enabled",
                    "actual",
                    True,
                ),
            ],
        },
        {
            "id": "staas",
            "acronym": "STaaS",
            "name": "Storage as a Service",
            "description": "Telemetry retention and export storage.",
            "icon": "hard-drive",
            "status": "live",
            "items": [
                item(
                    "Telemetry persistence",
                    f"Stored in {health['backend']} with configurable {settings.get('retention_days', 30)}-day retention.",
                    "Active",
                    "actual",
                    True,
                ),
                item(
                    "CSV export",
                    "Historical telemetry can be exported from the Reports page or the API.",
                    "Available",
                    "actual",
                    True,
                ),
                item(
                    "S3-compatible archive",
                    "No object storage bucket or credentials are configured.",
                    "Not connected",
                    "conceptual",
                    False,
                ),
            ],
        },
        {
            "id": "integrations",
            "acronym": "Integrations",
            "name": "External monitoring integrations",
            "description": "Connectors that would ingest metrics from external platforms.",
            "icon": "plug",
            "status": "not_configured",
            "items": [
                item(
                    "Remote CloudPulse agent",
                    f"{len(live_agents)} enrolled agent key(s)."
                    if live_agents
                    else "Agent enrollment is available; run the Python agent to stream real metrics.",
                    "Available",
                    "actual",
                    True,
                ),
                item(
                    "AWS CloudWatch",
                    "No CloudWatch API integration, role or credentials are configured.",
                    "Not connected",
                    "conceptual",
                    False,
                ),
                item(
                    "Azure Monitor / GCP Cloud Monitoring",
                    "No Azure or GCP integration is configured.",
                    "Not connected",
                    "conceptual",
                    False,
                ),
            ],
        },
    ]

    all_items = [entry for category in categories for entry in category["items"]]
    return jsonify(
        {
            "generated_at": iso(utcnow()),
            "mode": settings.get("mode", "demo"),
            "data_source": "simulated" if demo_mode else "live",
            "database": health,
            "summary": {
                "live_targets": len(live_servers),
                "demo_targets": len(demo_servers),
                "enrolled_agents": len(live_agents),
                "integrated_services": sum(1 for entry in all_items if entry["verified"]),
                "conceptual_services": sum(1 for entry in all_items if entry["kind"] == "conceptual"),
            },
            "categories": categories,
            "disclaimer": (
                "CloudPulse monitors only the hosts and agents registered with it. Simulated demo "
                "targets are labelled everywhere. AWS, Azure, GCP and S3 integrations are not implemented "
                "and are shown as conceptual, not as live connections."
            ),
        }
    )
