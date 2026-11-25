"""Background workers: demo generator, local collector, watchdog and detection."""
from __future__ import annotations

import logging
import threading
import time
from collections import deque
from datetime import timedelta

from flask import Flask

from .alerts import evaluate_availability
from .analytics import data_source_for
from .anomalies import detect_and_store
from .settings import get_settings
from .telemetry import (
    collect_local_metrics,
    ensure_local_server,
    generate_demo_tick,
)
from ..utils import iso, utcnow

logger = logging.getLogger(__name__)

_request_latencies: deque[float] = deque(maxlen=200)


def record_request_duration(seconds: float) -> None:
    _request_latencies.append(seconds)


def average_api_latency_ms() -> float:
    if not _request_latencies:
        return 18.0
    return round(sum(_request_latencies) / len(_request_latencies) * 1000, 1)


class Runtime:
    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.started_at = time.time()
        self.last_demo_tick = 0.0
        self.last_live_tick = 0.0
        self.last_watchdog = 0.0
        self.last_anomaly = 0.0
        self.last_cleanup = 0.0
        self.last_error: str | None = None
        self.settings_cache: dict | None = None
        self.settings_cached_at = 0.0

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self, app: Flask) -> None:
        if app.config.get("TESTING") or not app.config.get("ENABLE_BACKGROUND_WORKERS", True):
            logger.info("Background workers disabled")
            return
        if self.running:
            return
        app.extensions["cloudpulse_runtime"] = self
        self._thread = threading.Thread(
            target=self._run,
            args=(app,),
            name="cloudpulse-runtime",
            daemon=True,
        )
        self._thread.start()
        logger.info("Background workers started")

    def stop(self) -> None:
        self._stop.set()

    def _settings(self, store) -> dict:
        now = time.time()
        if self.settings_cache is None or now - self.settings_cached_at > 2:
            self.settings_cache = get_settings(store)
            self.settings_cached_at = now
        return self.settings_cache

    def _run(self, app: Flask) -> None:
        with app.app_context():
            store = app.extensions["cloudpulse_store"]
            time.sleep(1)
            while not self._stop.is_set():
                try:
                    self._tick(app, store)
                except Exception as exc:  # noqa: BLE001 - keep the worker alive
                    self.last_error = f"{type(exc).__name__}: {exc}"
                    logger.exception("Background worker tick failed")
                self._stop.wait(1)

    def _tick(self, app: Flask, store) -> None:
        now = time.time()
        settings = self._settings(store)
        interval = max(2, int(settings.get("monitoring_interval_seconds") or 5))
        mode = settings.get("mode", "demo")

        if mode == "demo" and now - self.last_demo_tick >= interval:
            self.last_demo_tick = now
            generate_demo_tick(store, settings)

        if mode == "live" and now - self.last_live_tick >= interval:
            self.last_live_tick = now
            if app.config.get("ENABLE_LOCAL_COLLECTOR", True):
                server = ensure_local_server(store)
                collect_local_metrics(store, server, average_api_latency_ms())

        if now - self.last_watchdog >= 5:
            self.last_watchdog = now
            source = data_source_for(settings)
            for server in store.find("servers", {"data_source": source}):
                evaluate_availability(store, server, settings)

        anomaly_interval = max(60, int(app.config.get("ANOMALY_INTERVAL_MINUTES", 10)) * 60)
        if now - self.last_anomaly >= anomaly_interval:
            self.last_anomaly = now
            detect_and_store(store, settings, triggered_by="scheduler")

        if now - self.last_cleanup >= 3600:
            self.last_cleanup = now
            self._cleanup(store, settings)

    def _cleanup(self, store, settings: dict) -> None:
        cutoff = iso(utcnow() - timedelta(days=max(1, int(settings.get("retention_days") or 30))))
        removed = store.delete("telemetry", {"timestamp": {"$lt": cutoff}})
        closed_alerts = store.delete(
            "alerts",
            {
                "status": "resolved",
                "resolved_at": {"$lt": iso(utcnow() - timedelta(days=180))},
            },
        )
        store.delete("revoked_tokens", {"expires_at": {"$lt": iso()}})
        if removed or closed_alerts:
            logger.info("Retention cleanup removed %s telemetry rows and %s alerts", removed, closed_alerts)


def create_runtime(app: Flask) -> Runtime:
    runtime = Runtime()
    runtime.start(app)
    return runtime
