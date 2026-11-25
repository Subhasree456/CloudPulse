"""Isolation Forest anomaly detection over historical telemetry."""
from __future__ import annotations

import logging
from datetime import timedelta

from ..utils import iso, new_id, parse_iso, utcnow
from .events import emit_event
from .settings import get_settings

logger = logging.getLogger(__name__)

FEATURES = [
    ("cpu_percent", "CPU utilisation", "%"),
    ("memory_percent", "Memory utilisation", "%"),
    ("disk_percent", "Disk utilisation", "%"),
    ("network_in_bps", "Network ingress", "Mbps"),
    ("network_out_bps", "Network egress", "Mbps"),
    ("response_time_ms", "Application response time", "ms"),
]
MINIMUM_POINTS = 40
MAX_ANOMALIES_PER_SERVER = 6


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def detect_and_store(
    store,
    settings: dict | None = None,
    *,
    data_source: str | None = None,
    triggered_by: str = "system",
    emit: bool = True,
) -> dict:
    settings = settings or get_settings(store)
    source = data_source or ("simulated" if settings.get("mode", "demo") == "demo" else "live")
    run_at = utcnow()

    if not settings.get("anomaly_detection_enabled", True):
        return {
            "status": "disabled",
            "message": "Anomaly detection is disabled in Settings.",
            "run_at": iso(run_at),
            "analyzed_servers": 0,
            "anomalies_found": 0,
            "new_anomalies": 0,
        }

    try:
        import numpy as np
        from sklearn.ensemble import IsolationForest
    except ImportError as exc:  # pragma: no cover - dependency is in requirements
        logger.error("Anomaly detection dependencies are missing: %s", exc)
        return {
            "status": "unavailable",
            "message": "scikit-learn and numpy are required for anomaly detection.",
            "run_at": iso(run_at),
            "analyzed_servers": 0,
            "anomalies_found": 0,
            "new_anomalies": 0,
        }

    servers = store.find("servers", {"data_source": source})
    window_start = run_at - timedelta(days=7)
    candidates: list[dict] = []
    analyzed_points = 0
    analyzed_servers = 0
    skipped_servers: list[str] = []

    for server in servers:
        rows = store.find(
            "telemetry",
            {
                "server_id": server["id"],
                "timestamp": {"$gte": iso(window_start)},
                "data_source": source,
            },
            sort=[("timestamp", 1)],
            limit=25000,
        )
        if len(rows) < MINIMUM_POINTS:
            skipped_servers.append(server.get("name", server["id"]))
            continue
        matrix = [[_to_float(row.get(feature)) for feature, _, _ in FEATURES] for row in rows]
        matrix_np = np.asarray(matrix, dtype=float)
        if matrix_np.shape[0] < MINIMUM_POINTS or np.allclose(matrix_np.std(axis=0), 0):
            skipped_servers.append(server.get("name", server["id"]))
            continue

        analyzed_servers += 1
        analyzed_points += len(rows)
        contamination = min(0.05, max(0.01, 6.0 / len(rows)))
        model = IsolationForest(
            n_estimators=160,
            contamination=contamination,
            random_state=42,
            n_jobs=1,
        )
        try:
            model.fit(matrix_np)
            predictions = model.predict(matrix_np)
            raw_scores = -model.score_samples(matrix_np)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Isolation Forest failed for %s: %s", server.get("id"), exc)
            skipped_servers.append(server.get("name", server["id"]))
            continue

        medians = np.median(matrix_np, axis=0)
        deviations = np.abs(matrix_np - medians)
        mad = np.median(deviations, axis=0)
        std = matrix_np.std(axis=0)
        scale = np.where(mad > 1e-9, mad * 1.4826, np.where(std > 1e-9, std, 1.0))

        flagged_indices = [index for index, flag in enumerate(predictions) if flag == -1]
        if not flagged_indices:
            continue
        flagged_raw = raw_scores[flagged_indices]
        low, high = float(flagged_raw.min()), float(flagged_raw.max())
        span = high - low if high > low else 1.0

        scored = []
        for index in flagged_indices:
            zscores = deviations[index] / scale
            feature_index = int(np.argmax(zscores))
            zscore = float(zscores[feature_index])
            normalized = 0.55 + 0.45 * ((float(raw_scores[index]) - low) / span)
            scored.append((normalized, zscore, index, feature_index))
        scored.sort(reverse=True, key=lambda item: item[0])

        used: list[tuple[str, object]] = []
        timestamped = [(parse_iso(row.get("timestamp")), row, index) for index, row in enumerate(rows)]
        timestamped = [(ts, row, index) for ts, row, index in timestamped if ts is not None]

        for normalized, zscore, index, feature_index in scored:
            feature, label, unit = FEATURES[feature_index]
            row = rows[index]
            timestamp = parse_iso(row.get("timestamp"))
            if timestamp is None:
                continue
            if any(
                used_feature == feature and abs((timestamp - used_ts).total_seconds()) < 20 * 60
                for used_feature, used_ts in used
            ):
                continue
            value = _to_float(row.get(feature))
            # Historical median for the affected metric.
            previous_values = [
                _to_float(item.get(feature))
                for item in rows[max(0, index - 30):index]
            ]
            expected = float(np.median(previous_values)) if previous_values else float(medians[feature_index])
            if feature.startswith("network_"):
                value = round(value / 1_000_000, 2)
                expected = round(expected / 1_000_000, 2)
            used.append((feature, timestamp))
            candidates.append(
                {
                    "id": new_id("anm_"),
                    "server_id": server["id"],
                    "server_name": server.get("name"),
                    "metric": feature,
                    "metric_label": label,
                    "unit": unit,
                    "value": round(value, 2),
                    "expected": round(expected, 2),
                    "anomaly_score": round(min(0.99, max(0.5, normalized)), 3),
                    "zscore": round(zscore, 2),
                    "severity": "critical" if normalized >= 0.78 or zscore >= 4 else "warning",
                    "timestamp": row.get("timestamp"),
                    "data_source": source,
                    "detection_method": "IsolationForest",
                    "detected_at": iso(run_at),
                    "run_by": triggered_by,
                    "created_at": iso(run_at),
                }
            )
            if len([item for item in candidates if item["server_id"] == server["id"]]) >= MAX_ANOMALIES_PER_SERVER:
                break

    existing_keys = {
        (item.get("server_id"), item.get("metric"), item.get("timestamp"))
        for item in store.find(
            "anomalies",
            {"timestamp": {"$gte": iso(window_start)}},
            limit=20000,
        )
    }
    new_anomalies = []
    for candidate in candidates:
        key = (candidate["server_id"], candidate["metric"], candidate["timestamp"])
        if key in existing_keys:
            continue
        existing_keys.add(key)
        new_anomalies.append(store.insert("anomalies", candidate))

    run = {
        "id": new_id("run_"),
        "status": "completed" if analyzed_servers else "insufficient_data",
        "data_source": source,
        "triggered_by": triggered_by,
        "analyzed_servers": analyzed_servers,
        "analyzed_points": analyzed_points,
        "anomalies_found": len(candidates),
        "new_anomalies": len(new_anomalies),
        "skipped_servers": skipped_servers,
        "run_at": iso(run_at),
        "message": (
            "Not enough historical telemetry yet. At least "
            f"{MINIMUM_POINTS} points per server are required."
            if analyzed_servers == 0
            else f"Analysed {analyzed_points:,} telemetry points across {analyzed_servers} server(s)."
        ),
    }
    store.insert("detection_runs", run)
    if new_anomalies and emit:
        emit_event("anomalies:updated", run)
    return run


def list_anomalies(store, *, data_source=None, server_id=None, start=None, end=None, severity=None, limit=200):
    query: dict = {}
    if data_source:
        query["data_source"] = data_source
    if server_id:
        query["server_id"] = server_id
    if severity:
        query["severity"] = severity
    if start or end:
        timestamp_query = {}
        if start:
            timestamp_query["$gte"] = start
        if end:
            timestamp_query["$lte"] = end
        query["timestamp"] = timestamp_query
    return store.find("anomalies", query, sort=[("timestamp", -1)], limit=limit)
