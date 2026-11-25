"""Monitoring configuration stored in the database."""
from __future__ import annotations

from copy import deepcopy

from ..utils import ValidationError, iso, utcnow

DEFAULT_THRESHOLDS = {
    "cpu": {"warning": 70, "critical": 85},
    "memory": {"warning": 75, "critical": 90},
    "disk": {"warning": 85, "critical": 95},
    "response_time_ms": {"warning": 500, "critical": 1000},
    "network_mbps": {"warning": 400, "critical": 800},
}

DEFAULT_SETTINGS = {
    "id": "global",
    "mode": "demo",
    "monitoring_interval_seconds": 5,
    "offline_after_seconds": 30,
    "retention_days": 30,
    "anomaly_detection_enabled": True,
    "auto_resolve_availability": True,
    "thresholds": DEFAULT_THRESHOLDS,
    "updated_at": None,
}


def ensure_settings(store, config: dict) -> dict:
    existing = store.find_one("settings", {"id": "global"})
    if existing:
        # Merge newly added defaults without clobbering user configuration.
        changed = False
        for key, value in DEFAULT_SETTINGS.items():
            if key not in existing:
                existing[key] = deepcopy(value)
                changed = True
        for key, value in DEFAULT_THRESHOLDS.items():
            if key not in existing.get("thresholds", {}):
                existing.setdefault("thresholds", {})[key] = deepcopy(value)
                changed = True
        if changed:
            existing["updated_at"] = iso()
            store.update("settings", {"id": "global"}, existing)
        return existing

    settings = deepcopy(DEFAULT_SETTINGS)
    settings["mode"] = config.get("DEMO_MODE_DEFAULT", "demo")
    settings["monitoring_interval_seconds"] = max(2, int(config.get("MONITORING_INTERVAL", 5)))
    settings["offline_after_seconds"] = max(10, int(config.get("OFFLINE_AFTER_SECONDS", 30)))
    settings["retention_days"] = max(1, int(config.get("RETENTION_DAYS", 30)))
    settings["updated_at"] = iso()
    return store.insert("settings", settings)


def get_settings(store) -> dict:
    settings = store.find_one("settings", {"id": "global"})
    if not settings:
        settings = deepcopy(DEFAULT_SETTINGS)
        settings["updated_at"] = iso()
        try:
            settings = store.insert("settings", settings)
        except Exception:  # noqa: BLE001 - another worker may have inserted it
            settings = store.find_one("settings", {"id": "global"}) or settings
    return settings


def validate_settings_payload(payload: dict, current: dict) -> dict:
    updated = deepcopy(current)
    if "mode" in payload:
        mode = str(payload["mode"]).lower().strip()
        if mode not in {"demo", "live"}:
            raise ValidationError("mode must be 'demo' or 'live'.", "mode")
        updated["mode"] = mode

    if "monitoring_interval_seconds" in payload:
        try:
            interval = int(payload["monitoring_interval_seconds"])
        except (TypeError, ValueError):
            raise ValidationError("Monitoring interval must be an integer.", "monitoring_interval_seconds") from None
        if not 2 <= interval <= 3600:
            raise ValidationError("Monitoring interval must be between 2 and 3600 seconds.", "monitoring_interval_seconds")
        updated["monitoring_interval_seconds"] = interval

    if "offline_after_seconds" in payload:
        try:
            offline = int(payload["offline_after_seconds"])
        except (TypeError, ValueError):
            raise ValidationError("Offline threshold must be an integer.", "offline_after_seconds") from None
        if not 10 <= offline <= 86400:
            raise ValidationError("Offline threshold must be between 10 and 86400 seconds.", "offline_after_seconds")
        updated["offline_after_seconds"] = offline

    if "retention_days" in payload:
        try:
            days = int(payload["retention_days"])
        except (TypeError, ValueError):
            raise ValidationError("Retention must be an integer.", "retention_days") from None
        if not 1 <= days <= 365:
            raise ValidationError("Retention must be between 1 and 365 days.", "retention_days")
        updated["retention_days"] = days

    if "anomaly_detection_enabled" in payload:
        updated["anomaly_detection_enabled"] = bool(payload["anomaly_detection_enabled"])

    if "auto_resolve_availability" in payload:
        updated["auto_resolve_availability"] = bool(payload["auto_resolve_availability"])

    if "thresholds" in payload:
        incoming = payload["thresholds"]
        if not isinstance(incoming, dict):
            raise ValidationError("thresholds must be an object.", "thresholds")
        thresholds = deepcopy(updated.get("thresholds", DEFAULT_THRESHOLDS))
        for category, limits in incoming.items():
            if category not in DEFAULT_THRESHOLDS:
                raise ValidationError(f"Unknown threshold category '{category}'.", "thresholds")
            if not isinstance(limits, dict):
                raise ValidationError("Each threshold must be an object.", "thresholds")
            for level, value in limits.items():
                if level not in {"warning", "critical"}:
                    raise ValidationError("Threshold levels must be warning or critical.", "thresholds")
                try:
                    numeric = float(value)
                except (TypeError, ValueError):
                    raise ValidationError("Threshold values must be numeric.", "thresholds") from None
                if not 0 <= numeric <= 100000:
                    raise ValidationError("Threshold values must be between 0 and 100000.", "thresholds")
                thresholds.setdefault(category, {})[level] = numeric
        for category in DEFAULT_THRESHOLDS:
            warning = thresholds[category].get("warning")
            critical = thresholds[category].get("critical")
            if warning is None or critical is None or warning >= critical:
                raise ValidationError(
                    f"{category.replace('_', ' ').title()} warning must be lower than critical.",
                    "thresholds",
                )
        updated["thresholds"] = thresholds

    updated["updated_at"] = iso()
    return updated


def effective_offline_seconds(settings: dict) -> int:
    interval = int(settings.get("monitoring_interval_seconds") or 5)
    configured = int(settings.get("offline_after_seconds") or 30)
    return max(configured, interval * 3)
