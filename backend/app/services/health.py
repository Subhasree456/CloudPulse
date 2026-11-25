"""Infrastructure health scoring and status classification."""
from __future__ import annotations

from datetime import timedelta

from ..utils import clamp


def classify_score(score: float) -> str:
    if score >= 90:
        return "excellent"
    if score >= 75:
        return "healthy"
    if score >= 50:
        return "warning"
    return "critical"


def status_from_metrics(
    cpu: float | None,
    memory: float | None,
    disk: float | None,
    response_time_ms: float | None,
    thresholds: dict,
    *,
    online: bool = True,
) -> str:
    """Return healthy | warning | critical | offline for a server snapshot."""
    if not online:
        return "offline"
    checks = [
        (cpu, thresholds.get("cpu", {})),
        (memory, thresholds.get("memory", {})),
        (disk, thresholds.get("disk", {})),
        (response_time_ms, thresholds.get("response_time_ms", {})),
    ]
    status = "healthy"
    for value, limits in checks:
        if value is None:
            continue
        critical = limits.get("critical")
        warning = limits.get("warning")
        if critical is not None and value >= critical:
            return "critical"
        if warning is not None and value >= warning:
            status = "warning"
    return status


def health_score(metrics: dict, *, online: bool = True, thresholds: dict | None = None) -> float:
    """Compute a 0-100 infrastructure health score.

    Weighting: CPU 25, memory 20, disk 20, response time 15, network 10,
    availability 10. Penalties only begin above comfortable operating levels.
    """
    if not online:
        return 0.0

    cpu = float(metrics.get("cpu_percent") or 0)
    memory = float(metrics.get("memory_percent") or 0)
    disk = float(metrics.get("disk_percent") or 0)
    response = float(metrics.get("response_time_ms") or 0)
    network_mbps = float(metrics.get("network_throughput_bps") or 0) / 1_000_000

    cpu_penalty = max(0.0, (cpu - 55) / 45) * 25
    memory_penalty = max(0.0, (memory - 60) / 40) * 20
    disk_penalty = max(0.0, (disk - 65) / 35) * 20
    response_penalty = max(0.0, (response - 250) / 750) * 15
    network_penalty = max(0.0, (network_mbps - 500) / 500) * 10

    score = 100 - (cpu_penalty + memory_penalty + disk_penalty + response_penalty + network_penalty)
    if metrics.get("health_override_offline"):
        return 0.0
    return round(clamp(score), 1)


def availability_from_last_seen(last_seen_iso: str | None, offline_after_seconds: int, now=None) -> bool:
    from .utils import parse_iso, utcnow

    last_seen = parse_iso(last_seen_iso)
    if not last_seen:
        return False
    return (now or utcnow()) - last_seen <= timedelta(seconds=offline_after_seconds)
