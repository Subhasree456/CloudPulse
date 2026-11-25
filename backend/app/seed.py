"""Bootstrap data: admin account, demo infrastructure, alerts and history."""
from __future__ import annotations

import hashlib
import logging
from datetime import timedelta

from .auth import hash_password
from .services.alerts import create_alert, evaluate_availability, evaluate_metrics, resolve_alert
from .services.settings import ensure_settings
from .services.telemetry import DEMO_PROFILES, seed_history
from .utils import iso, new_id, parse_iso, utcnow

logger = logging.getLogger(__name__)

DEMO_SERVERS = [
    {
        "id": "srv-01",
        "name": "prod-web-01",
        "hostname": "web-01.cloudpulse.internal",
        "ip_address": "10.0.12.11",
        "os": "Ubuntu 24.04 LTS",
        "resource_type": "Virtual Machine",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-east-1",
        "environment": "production",
        "tags": ["web", "public"],
        "cost_per_hour": 0.096,
    },
    {
        "id": "srv-02",
        "name": "prod-api-02",
        "hostname": "api-02.cloudpulse.internal",
        "ip_address": "10.0.12.12",
        "os": "Ubuntu 24.04 LTS",
        "resource_type": "Virtual Machine",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-east-1",
        "environment": "production",
        "tags": ["api", "critical"],
        "cost_per_hour": 0.192,
    },
    {
        "id": "srv-03",
        "name": "storage-node-01",
        "hostname": "storage-01.cloudpulse.internal",
        "ip_address": "10.0.12.21",
        "os": "Debian 12",
        "resource_type": "Storage",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-east-1",
        "environment": "production",
        "tags": ["storage", "primary"],
        "cost_per_hour": 0.064,
    },
    {
        "id": "srv-04",
        "name": "legacy-app-04",
        "hostname": "legacy-04.cloudpulse.internal",
        "ip_address": "10.0.12.34",
        "os": "Windows Server 2019",
        "resource_type": "Application",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-east-1",
        "environment": "production",
        "tags": ["legacy", "application"],
        "cost_per_hour": 0.145,
    },
    {
        "id": "srv-05",
        "name": "db-primary-01",
        "hostname": "db-01.cloudpulse.internal",
        "ip_address": "10.0.12.41",
        "os": "Ubuntu 22.04 LTS",
        "resource_type": "Database",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-east-1",
        "environment": "production",
        "tags": ["database", "primary"],
        "cost_per_hour": 0.28,
    },
    {
        "id": "srv-06",
        "name": "edge-cache-01",
        "hostname": "edge-01.cloudpulse.internal",
        "ip_address": "10.0.12.51",
        "os": "Alpine Linux 3.20",
        "resource_type": "Container",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-west-2",
        "environment": "production",
        "tags": ["edge", "cache"],
        "cost_per_hour": 0.038,
    },
    {
        "id": "srv-07",
        "name": "analytics-worker",
        "hostname": "analytics-01.cloudpulse.internal",
        "ip_address": "10.0.12.61",
        "os": "Ubuntu 24.04 LTS",
        "resource_type": "Virtual Machine",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-west-2",
        "environment": "staging",
        "tags": ["analytics", "batch"],
        "cost_per_hour": 0.112,
    },
    {
        "id": "srv-08",
        "name": "backup-node",
        "hostname": "backup-01.cloudpulse.internal",
        "ip_address": "10.0.12.71",
        "os": "Debian 12",
        "resource_type": "Storage",
        "provider": "CloudPulse Demo Cloud",
        "region": "us-west-2",
        "environment": "production",
        "tags": ["backup", "archive"],
        "cost_per_hour": 0.058,
    },
]


def seed_database(store, config: dict) -> dict:
    settings = ensure_settings(store, config)
    result = {"admin_created": False, "servers_created": 0, "telemetry_seeded": 0, "alerts_created": 0}

    if store.count("users") == 0:
        now = iso()
        email = config["SEED_ADMIN_EMAIL"].lower()
        # A stable id lets tokens issued by one serverless instance resolve on
        # another instance that seeded its own copy of the demo database.
        admin_id = "user_" + hashlib.sha256(email.encode("utf-8")).hexdigest()[:32]
        admin = {
            "id": admin_id,
            "name": config.get("SEED_ADMIN_NAME", "Alex Morgan"),
            "email": email,
            "password_hash": hash_password(config["SEED_ADMIN_PASSWORD"]),
            "role": "admin",
            "created_at": now,
            "updated_at": now,
            "last_login_at": now,
        }
        store.insert("users", admin)
        result["admin_created"] = True
        logger.info("Seeded administrator account %s", config["SEED_ADMIN_EMAIL"])

    have_servers = store.count("servers") > 0
    if not have_servers and config.get("SEED_DEMO_DATA", True):
        now = utcnow()
        created_at = iso(now - timedelta(days=10))
        monitoring_since = iso(now - timedelta(days=7))
        servers = []
        for template in DEMO_SERVERS:
            profile = DEMO_PROFILES[template["id"]]
            server = {
                **template,
                "status": "offline" if profile.get("offline") else "healthy",
                "health_score": 0 if profile.get("offline") else 90,
                "data_source": "simulated",
                "simulated": True,
                "is_local": False,
                "agent_key_hash": None,
                "registered_at": created_at,
                "monitoring_since": monitoring_since,
                "last_seen": iso(now - timedelta(minutes=50)) if profile.get("offline") else iso(now),
                "latest_metrics": None,
                "demo_baseline": profile,
                "created_at": created_at,
                "updated_at": iso(now),
            }
            servers.append(store.insert("servers", server))
        result["servers_created"] = len(servers)
        logger.info("Seeded %s simulated servers", len(servers))

        result["telemetry_seeded"] = seed_history(store, servers)
        servers = store.find("servers", {"data_source": "simulated"})

        for server in servers:
            latest = store.find_one(
                "telemetry",
                {"server_id": server["id"]},
                sort=[("timestamp", -1)],
            )
            if latest and server.get("status") != "offline":
                created = evaluate_metrics(store, server, latest, settings, emit=False)
                result["alerts_created"] += len(created)
            created = evaluate_availability(store, server, settings, emit=False)
            if created:
                result["alerts_created"] += 1

        # One resolved event so the alert history demonstrates the full lifecycle.
        resolved = create_alert(
            store,
            {"id": "srv-06", "name": "edge-cache-01", "data_source": "simulated", "status": "warning"},
            "network",
            "warning",
            "Network throughput on edge-cache-01 exceeded 400 Mbps for four minutes.",
            metric_value=612.4,
            threshold=400,
            emit=False,
        )
        resolve_alert(
            store,
            resolved["id"],
            resolved_by="Alex Morgan",
            reason="Traffic returned to baseline after the cache warm-up completed.",
            emit=False,
        )
        result["alerts_created"] += 1

    return result
