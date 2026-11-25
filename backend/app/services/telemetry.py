"""Telemetry collection, ingestion and realistic demo data generation."""
from __future__ import annotations

import logging
import math
import os
import random
import socket
import threading
import time
from datetime import datetime, timedelta, timezone

from ..utils import clamp, iso, new_id, parse_iso, utcnow
from .alerts import evaluate_metrics
from .events import emit_event
from .health import health_score, status_from_metrics
from .settings import DEFAULT_THRESHOLDS, get_settings

logger = logging.getLogger(__name__)

_demo_lock = threading.RLock()
_demo_state: dict[str, dict] = {}
_net_state: dict[str, tuple[float, int, int]] = {}

DEMO_PROFILES = {
    "srv-01": {
        "cpu": 34, "memory": 51, "disk": 47, "network_mbps": 140,
        "response_time_ms": 92, "total_memory_mb": 16384, "boot_days_ago": 41,
    },
    "srv-02": {
        "cpu": 91, "memory": 72, "disk": 63, "network_mbps": 290,
        "response_time_ms": 215, "total_memory_mb": 32768, "boot_days_ago": 12,
    },
    "srv-03": {
        "cpu": 18, "memory": 39, "disk": 87.4, "network_mbps": 45,
        "response_time_ms": 68, "total_memory_mb": 16384, "boot_days_ago": 88,
    },
    "srv-04": {
        "cpu": 0, "memory": 0, "disk": 58, "network_mbps": 0,
        "response_time_ms": 0, "total_memory_mb": 8192, "boot_days_ago": 210,
        "offline": True,
    },
    "srv-05": {
        "cpu": 44, "memory": 66, "disk": 55, "network_mbps": 175,
        "response_time_ms": 128, "total_memory_mb": 32768, "boot_days_ago": 63,
    },
    "srv-06": {
        "cpu": 24, "memory": 33, "disk": 29, "network_mbps": 190,
        "response_time_ms": 56, "total_memory_mb": 8192, "boot_days_ago": 29,
    },
    "srv-07": {
        "cpu": 57, "memory": 68, "disk": 69, "network_mbps": 230,
        "response_time_ms": 244, "total_memory_mb": 16384, "boot_days_ago": 7,
    },
    "srv-08": {
        "cpu": 11, "memory": 23, "disk": 78, "network_mbps": 60,
        "response_time_ms": 87, "total_memory_mb": 16384, "boot_days_ago": 120,
    },
}


def _server_profile(server: dict) -> dict:
    profile = dict(DEMO_PROFILES.get(server.get("id"), {}))
    profile.update(server.get("demo_baseline") or {})
    return profile


def _online(server: dict, timestamp: datetime | None = None) -> bool:
    return not bool((server.get("demo_baseline") or {}).get("offline"))


def _next_demo_metrics(server: dict, now: datetime) -> dict:
    profile = _server_profile(server)
    with _demo_lock:
        state = _demo_state.get(server["id"])
        if state is None:
            latest = server.get("latest_metrics") or {}
            state = {
                "cpu": float(latest.get("cpu_percent") or profile.get("cpu", 30)),
                "memory": float(latest.get("memory_percent") or profile.get("memory", 50)),
                "disk": float(latest.get("disk_percent") or profile.get("disk", 50)),
                "network": float(latest.get("network_throughput_bps") or 0) / 1_000_000
                or float(profile.get("network_mbps", 100)),
                "response": float(latest.get("response_time_ms") or profile.get("response_time_ms", 100)),
                "rng": random.Random(),
            }
            _demo_state[server["id"]] = state

        rng: random.Random = state["rng"]
        base_cpu = float(profile.get("cpu", 30))
        base_memory = float(profile.get("memory", 50))
        base_disk = float(profile.get("disk", 50))
        base_network = float(profile.get("network_mbps", 100))
        base_response = float(profile.get("response_time_ms", 100))

        wave = math.sin(now.timestamp() / 420) * 3.5
        state["cpu"] = clamp(0.72 * state["cpu"] + 0.28 * base_cpu + wave + rng.uniform(-2.2, 2.2))
        state["memory"] = clamp(0.85 * state["memory"] + 0.15 * base_memory + rng.uniform(-1.1, 1.1))
        state["disk"] = clamp(max(base_disk, state["disk"] + rng.uniform(0.0, 0.012)), 0, 99)
        state["network"] = max(1.0, 0.7 * state["network"] + 0.3 * base_network + rng.uniform(-9, 9))
        state["response"] = max(8.0, 0.75 * state["response"] + 0.25 * base_response + rng.uniform(-18, 18))

        # Occasional, clearly simulated bursts. They make anomaly detection and
        # the alert engine observable during a review.
        network_burst = server["id"] in {"srv-06", "srv-07"} and rng.random() < 0.035
        cpu_burst = server["id"] in {"srv-05", "srv-07"} and rng.random() < 0.02
        if network_burst:
            state["network"] *= rng.uniform(3.2, 5.5)
        if cpu_burst:
            state["cpu"] = clamp(state["cpu"] + rng.uniform(16, 30))

        cpu = state["cpu"]
        memory = state["memory"]
        disk = state["disk"]
        network_mbps = state["network"]
        response = state["response"]

    total_memory = float(profile.get("total_memory_mb", 16384))
    inbound_share = 0.58 + math.sin(now.timestamp() / 300) * 0.08
    network_in_bps = int(network_mbps * 1_000_000 * inbound_share)
    network_out_bps = int(network_mbps * 1_000_000 * (1 - inbound_share))
    boot_days = float(profile.get("boot_days_ago", 30))
    uptime_seconds = int((boot_days * 86400) + (now.timestamp() % 86400))

    return {
        "cpu_percent": round(cpu, 2),
        "memory_percent": round(memory, 2),
        "memory_available_mb": round(total_memory * (1 - memory / 100), 1),
        "memory_total_mb": total_memory,
        "disk_percent": round(disk, 2),
        "network_in_bps": network_in_bps,
        "network_out_bps": network_out_bps,
        "network_throughput_bps": network_in_bps + network_out_bps,
        "response_time_ms": round(response, 1),
        "uptime_seconds": uptime_seconds,
        "load_average": round(cpu / 100 * (os.cpu_count() or 4), 2),
    }


def generate_demo_tick(store, settings: dict | None = None) -> list[dict]:
    """Generate one simulated telemetry point for every online demo server."""
    settings = settings or get_settings(store)
    servers = store.find("servers", {"data_source": "simulated"})
    now = utcnow()
    recorded = []
    for server in servers:
        if not _online(server):
            if server.get("status") != "offline":
                stale_seen = parse_iso(server.get("last_seen")) or (now - timedelta(minutes=50))
                server.update(
                    {
                        "status": "offline",
                        "health_score": 0,
                        "last_seen": iso(stale_seen),
                        "updated_at": iso(now),
                    }
                )
                store.update("servers", {"id": server["id"]}, server)
                emit_event("server:updated", server)
            continue
        metrics = _next_demo_metrics(server, now)
        recorded.append(
            record_telemetry(store, server, metrics, settings, timestamp=now, data_source="simulated")
        )
    return recorded


def record_telemetry(
    store,
    server: dict,
    metrics: dict,
    settings: dict,
    *,
    timestamp: datetime | None = None,
    data_source: str | None = None,
    emit: bool = True,
) -> dict:
    """Persist one telemetry sample, update the server snapshot and run alerts."""
    timestamp = timestamp or utcnow()
    data_source = data_source or server.get("data_source", "simulated")

    def num(key: str, default: float = 0.0) -> float:
        value = metrics.get(key, default)
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    cpu = clamp(num("cpu_percent"))
    memory = clamp(num("memory_percent"))
    disk = clamp(num("disk_percent"))
    net_in = max(0.0, num("network_in_bps"))
    net_out = max(0.0, num("network_out_bps"))
    response = max(0.0, num("response_time_ms", 0.0))
    memory_total = max(0.0, num("memory_total_mb", 0.0))
    memory_available = num(
        "memory_available_mb",
        memory_total * (1 - memory / 100) if memory_total else 0.0,
    )
    uptime_seconds = max(0.0, num("uptime_seconds", 0.0))

    metric = {
        "id": new_id("tel_"),
        "server_id": server["id"],
        "server_name": server.get("name"),
        "timestamp": iso(timestamp),
        "cpu_percent": round(cpu, 2),
        "memory_percent": round(memory, 2),
        "memory_available_mb": round(memory_available, 1),
        "memory_total_mb": round(memory_total, 1),
        "disk_percent": round(disk, 2),
        "network_in_bps": int(net_in),
        "network_out_bps": int(net_out),
        "network_throughput_bps": int(net_in + net_out),
        "response_time_ms": round(response, 1),
        "uptime_seconds": int(uptime_seconds),
        "load_average": round(num("load_average", 0.0), 2),
        "data_source": data_source,
        "simulated": data_source == "simulated",
        "received_at": iso(),
    }
    store.insert("telemetry", metric)

    thresholds = settings.get("thresholds", {})
    status = status_from_metrics(cpu, memory, disk, response, thresholds, online=True)
    score = health_score(metric, thresholds=thresholds)
    latest = {
        key: metric[key]
        for key in (
            "timestamp", "cpu_percent", "memory_percent", "memory_available_mb",
            "memory_total_mb", "disk_percent", "network_in_bps", "network_out_bps",
            "network_throughput_bps", "response_time_ms", "uptime_seconds",
            "load_average",
        )
    }
    server.update(
        {
            "status": status,
            "health_score": score,
            "latest_metrics": latest,
            "last_seen": iso(timestamp),
            "updated_at": iso(),
        }
    )
    server = store.update("servers", {"id": server["id"]}, server) or server

    evaluate_metrics(store, server, metric, settings, emit=emit)

    if emit:
        emit_event(
            "telemetry:update",
            {
                "server_id": server["id"],
                "server_name": server.get("name"),
                "data_source": data_source,
                "simulated": data_source == "simulated",
                "timestamp": metric["timestamp"],
                "status": status,
                "health_score": score,
                "metrics": {
                    "cpu_percent": metric["cpu_percent"],
                    "memory_percent": metric["memory_percent"],
                    "disk_percent": metric["disk_percent"],
                    "network_in_mbps": round(net_in / 1_000_000, 3),
                    "network_out_mbps": round(net_out / 1_000_000, 3),
                    "network_mbps": round((net_in + net_out) / 1_000_000, 3),
                    "response_time_ms": metric["response_time_ms"],
                    "uptime_seconds": metric["uptime_seconds"],
                },
            },
        )
    return metric


# ---------------------------------------------------------------------------
# Local live collector
# ---------------------------------------------------------------------------
def ensure_local_server(store) -> dict:
    server = store.find_one("servers", {"id": "local-host"})
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
    except OSError:
        hostname = "local-host"
        local_ip = "127.0.0.1"
    if server:
        if server.get("data_source") != "live":
            server["data_source"] = "live"
            server["simulated"] = False
            store.update("servers", {"id": "local-host"}, server)
        return server

    try:
        import platform

        os_name = f"{platform.system()} {platform.release()}"
    except Exception:  # noqa: BLE001
        os_name = "Unknown"
    now = iso()
    server = {
        "id": "local-host",
        "name": "control-plane-local",
        "hostname": hostname,
        "ip_address": local_ip,
        "os": os_name,
        "resource_type": "Virtual Machine",
        "provider": "Local host",
        "region": "on-premise",
        "environment": "development",
        "status": "online",
        "health_score": 100,
        "data_source": "live",
        "simulated": False,
        "is_local": True,
        "agent_key_hash": None,
        "tags": ["local-collector"],
        "cost_per_hour": 0,
        "registered_at": now,
        "last_seen": now,
        "created_at": now,
        "updated_at": now,
        "latest_metrics": None,
    }
    return store.insert("servers", server)


def collect_local_metrics(store, server: dict, response_time_ms: float = 25.0) -> dict | None:
    try:
        import psutil
    except ImportError:
        logger.warning("psutil is not installed; local telemetry is unavailable.")
        return None

    now = utcnow()
    try:
        # A short blocking sample is required here: two back-to-back
        # interval=None calls measure only microseconds and report ~0%.
        cpu = psutil.cpu_percent(interval=0.1)
        virtual = psutil.virtual_memory()
        disk_path = os.path.abspath(os.sep)
        disk = psutil.disk_usage(disk_path)
        counters = psutil.net_io_counters()
        boot_time = psutil.boot_time()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Local telemetry collection failed: %s", exc)
        return None

    previous = _net_state.get(server["id"])
    now_ts = now.timestamp()
    if previous:
        elapsed = max(0.001, now_ts - previous[0])
        in_bps = max(0, (counters.bytes_recv - previous[1]) / elapsed)
        out_bps = max(0, (counters.bytes_sent - previous[2]) / elapsed)
    else:
        in_bps = out_bps = 0
    _net_state[server["id"]] = (now_ts, counters.bytes_recv, counters.bytes_sent)

    total_memory = float(virtual.total) / 1024 / 1024
    available_memory = float(virtual.available) / 1024 / 1024
    uptime = max(0.0, now_ts - float(boot_time))

    metrics = {
        "cpu_percent": clamp(float(cpu)),
        "memory_percent": clamp(float(virtual.percent)),
        "memory_available_mb": round(available_memory, 1),
        "memory_total_mb": round(total_memory, 1),
        "disk_percent": clamp(float(disk.percent)),
        "network_in_bps": int(in_bps),
        "network_out_bps": int(out_bps),
        "response_time_ms": round(float(response_time_ms), 1),
        "uptime_seconds": int(uptime),
        "load_average": round(float(getattr(psutil, "getloadavg", lambda: [0])()[0]), 2) if hasattr(psutil, "getloadavg") else 0,
    }
    settings = get_settings(store)
    server.update(
        {
            "hostname": socket.gethostname(),
            "ip_address": server.get("ip_address") or "127.0.0.1",
            "status": "online",
        }
    )
    return record_telemetry(store, server, metrics, settings, timestamp=now, data_source="live")


# ---------------------------------------------------------------------------
# Historical seed data
# ---------------------------------------------------------------------------
def _seeded_metrics(server: dict, timestamp: datetime, rng: random.Random) -> dict:
    profile = _server_profile(server)
    phase = timestamp.timestamp()
    day_wave = math.sin(phase / 7200 + hash(server["id"]) % 13) * 4.5
    short_wave = math.sin(phase / 900 + hash(server["id"]) % 7) * 2.2
    cpu = clamp(profile["cpu"] + day_wave + short_wave + rng.uniform(-4.5, 4.5))
    memory = clamp(profile["memory"] + math.sin(phase / 10800) * 3 + rng.uniform(-2.5, 2.5))
    disk = clamp(profile["disk"] + math.sin(phase / 86400) * 0.7 + rng.uniform(-0.2, 0.2), 0, 99)
    network = max(2.0, profile["network_mbps"] * (0.82 + rng.uniform(-0.2, 0.28)))
    response = max(10.0, profile["response_time_ms"] * (0.85 + rng.uniform(-0.25, 0.4)))

    hour = timestamp.hour
    business_hours = 1.35 if 9 <= hour <= 19 else 0.75
    cpu = clamp(cpu * (0.9 + business_hours * 0.12))
    network *= business_hours

    # Inject a handful of realistic anomalies for the detector to discover.
    minutes_ago = (utcnow() - timestamp).total_seconds() / 60
    if server["id"] == "srv-07" and (175 <= minutes_ago <= 185):
        cpu = clamp(cpu + 33)
    if server["id"] == "srv-06" and (295 <= minutes_ago <= 305):
        network *= 5.8
    if server["id"] == "srv-05" and (1550 <= minutes_ago <= 1565):
        memory = clamp(memory + 25)
    if server["id"] == "srv-01" and (800 <= minutes_ago <= 810):
        response += 900

    inbound_share = 0.58 + math.sin(phase / 1800) * 0.07
    total_memory = float(profile.get("total_memory_mb", 16384))
    boot_days = float(profile.get("boot_days_ago", 30))
    uptime_seconds = int((boot_days * 86400) + rng.randint(0, 80000))
    return {
        "cpu_percent": round(cpu, 2),
        "memory_percent": round(memory, 2),
        "memory_available_mb": round(total_memory * (1 - memory / 100), 1),
        "memory_total_mb": total_memory,
        "disk_percent": round(disk, 2),
        "network_in_bps": int(network * 1_000_000 * inbound_share),
        "network_out_bps": int(network * 1_000_000 * (1 - inbound_share)),
        "network_throughput_bps": int(network * 1_000_000),
        "response_time_ms": round(response, 1),
        "uptime_seconds": uptime_seconds,
        "load_average": round(cpu / 100 * (os.cpu_count() or 4), 2),
    }


def seed_history(store, servers: list[dict], *, days: int = 7) -> int:
    """Seed a week of simulated telemetry so charts, analytics and anomaly
    detection are meaningful immediately after a fresh install."""
    existing = store.count("telemetry", {"data_source": "simulated"})
    if existing > 0:
        return 0

    now = utcnow().replace(second=0, microsecond=0)
    timestamps: list[datetime] = []
    # High resolution for the last hour.
    timestamps.extend(now - timedelta(minutes=minute) for minute in range(60, 0, -1))
    # Medium resolution for the rest of the day.
    timestamps.extend(now - timedelta(minutes=minute) for minute in range(90, 24 * 60, 5))
    # Low resolution for the previous six days.
    timestamps.extend(now - timedelta(minutes=minute) for minute in range(24 * 60, days * 24 * 60, 30))
    timestamps = sorted(set(timestamps))

    records: list[dict] = []
    latest_snapshots: dict[str, dict] = {}
    for server in servers:
        if server.get("data_source") != "simulated":
            continue
        profile = _server_profile(server)
        offline = bool(profile.get("offline"))
        for timestamp in timestamps:
            if offline and timestamp > now - timedelta(minutes=45):
                continue
            rng = random.Random(f"{server['id']}-{int(timestamp.timestamp())}")
            metrics = _seeded_metrics(server, timestamp, rng)
            record = {
                "id": new_id("tel_"),
                "server_id": server["id"],
                "server_name": server.get("name"),
                "timestamp": iso(timestamp),
                **metrics,
                "data_source": "simulated",
                "simulated": True,
                "seeded": True,
                "received_at": iso(),
            }
            records.append(record)
            latest_snapshots[server["id"]] = record

    store.insert_many("telemetry", records)

    for server in servers:
        if server.get("data_source") != "simulated":
            continue
        latest = latest_snapshots.get(server["id"])
        if not latest:
            continue
        profile = _server_profile(server)
        offline = bool(profile.get("offline"))
        if offline:
            last_seen = iso(now - timedelta(minutes=50))
            status = "offline"
            score = 0
        else:
            last_seen = iso()
            status = status_from_metrics(
                latest["cpu_percent"], latest["memory_percent"], latest["disk_percent"],
                latest["response_time_ms"], DEFAULT_THRESHOLDS_FOR_SEED,
            )
            score = health_score(latest, thresholds=DEFAULT_THRESHOLDS_FOR_SEED)
        server.update(
            {
                "latest_metrics": {
                    key: latest[key]
                    for key in (
                        "timestamp", "cpu_percent", "memory_percent", "memory_available_mb",
                        "memory_total_mb", "disk_percent", "network_in_bps", "network_out_bps",
                        "network_throughput_bps", "response_time_ms", "uptime_seconds",
                        "load_average",
                    )
                },
                "last_seen": last_seen,
                "status": status,
                "health_score": score,
                "updated_at": iso(),
            }
        )
        store.update("servers", {"id": server["id"]}, server)

    logger.info("Seeded %s simulated telemetry points across %s servers", len(records), len(latest_snapshots))
    return len(records)


# Imported at the bottom to avoid a circular import in the seed helpers.
from ..services.settings import DEFAULT_THRESHOLDS as DEFAULT_THRESHOLDS_FOR_SEED  # noqa: E402
