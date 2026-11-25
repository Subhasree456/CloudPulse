"""CloudPulse Flask application factory."""
from __future__ import annotations

import logging
import os
import time
from logging.handlers import RotatingFileHandler

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO
from werkzeug.exceptions import HTTPException

from .auth import AuthError, authenticate
from .config import load_config
from .db import Store
from .services.anomalies import detect_and_store
from .services.runtime import create_runtime, record_request_duration
from .services.settings import get_settings
from .seed import seed_database
from .utils import ValidationError, iso

socketio = SocketIO(async_mode="threading", cors_allowed_origins="*", logger=False, engineio_logger=False)


def _configure_logging(app_config: dict) -> None:
    level = getattr(logging, app_config.get("LOG_LEVEL", "INFO"), logging.INFO)
    formatter = logging.Formatter("%(asctime)s | %(levelname)-7s | %(name)s | %(message)s")
    root = logging.getLogger()
    if root.level > level:
        root.setLevel(level)

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    if not any(isinstance(handler, logging.StreamHandler) and getattr(handler, "_cloudpulse", False) for handler in root.handlers):
        console._cloudpulse = True
        root.addHandler(console)

    log_dir = app_config.get("LOG_DIR")
    if log_dir:
        try:
            os.makedirs(log_dir, exist_ok=True)
            file_handler = RotatingFileHandler(
                os.path.join(log_dir, "cloudpulse.log"),
                maxBytes=5 * 1024 * 1024,
                backupCount=3,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            file_handler._cloudpulse = True
            root.addHandler(file_handler)
        except OSError:
            logging.getLogger(__name__).warning("Could not open log file in %s", log_dir)


def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    config = load_config()
    if overrides:
        config.update(overrides)
    app.config.update(config)
    app.config["MAX_CONTENT_LENGTH"] = config.get("MAX_CONTENT_LENGTH", 1024 * 1024)
    app.json.ensure_ascii = False
    app.extensions["cloudpulse_started_at"] = time.time()

    _configure_logging(config)
    logger = logging.getLogger(__name__)
    logger.info(
        "Starting CloudPulse API (environment=%s, database_mode=%s)",
        config.get("ENVIRONMENT"),
        "mongodb" if config.get("MONGO_URI") else "sqlite-fallback",
    )
    if config.get("GENERATED_SECRET"):
        logger.warning("Using a generated development SECRET_KEY. Set SECRET_KEY in production.")

    app.secret_key = config["SECRET_KEY"]
    allowed_origins = config.get("ALLOWED_ORIGINS") or ["http://localhost:5173"]
    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": allowed_origins,
                "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                "allow_headers": [
                    "Content-Type",
                    "Authorization",
                    "X-Agent-Key",
                    "X-Enrollment-Token",
                ],
                "expose_headers": ["Content-Disposition", "X-Report-Id"],
                "max_age": 600,
            }
        },
    )

    socketio.init_app(
        app,
        async_mode="threading",
        cors_allowed_origins=allowed_origins if "*" not in allowed_origins else "*",
        ping_interval=25,
        ping_timeout=60,
    )
    app.extensions["cloudpulse_socketio"] = socketio

    store = Store(config)
    app.extensions["cloudpulse_store"] = store

    @socketio.on("connect")
    def handle_connect(auth):
        token = None
        if isinstance(auth, dict):
            token = auth.get("token")
        token = token or request.args.get("token")
        user = authenticate(store, token)
        if not user:
            logger.info("Socket connection rejected: invalid or missing token")
            return False
        g.socket_user = user
        return True

    from .routes.alerts import bp as alerts_bp
    from .routes.analytics import bp as analytics_bp
    from .routes.anomalies import bp as anomalies_bp
    from .routes.auth import bp as auth_bp
    from .routes.dashboard import bp as dashboard_bp
    from .routes.meta import bp as meta_bp
    from .routes.reports import bp as reports_bp
    from .routes.servers import bp as servers_bp
    from .routes.services import bp as services_bp
    from .routes.settings import bp as settings_bp
    from .routes.telemetry import bp as telemetry_bp

    for blueprint in (
        auth_bp,
        dashboard_bp,
        servers_bp,
        telemetry_bp,
        alerts_bp,
        anomalies_bp,
        analytics_bp,
        reports_bp,
        settings_bp,
        services_bp,
        meta_bp,
    ):
        app.register_blueprint(blueprint)

    @app.before_request
    def _start_timer():
        g._request_started = time.perf_counter()

    @app.after_request
    def _finish_request(response):
        started = getattr(g, "_request_started", None)
        if started:
            duration = time.perf_counter() - started
            record_request_duration(duration)
            response.headers["X-Process-Time"] = f"{duration * 1000:.1f}ms"
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if request.is_secure:
            response.headers.setdefault("Strict-Transport-Security", "max-age=15552000; includeSubDomains")
        if request.path == "/api/docs":
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://cdn.jsdelivr.net",
            )
        elif request.path.startswith("/api/"):
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.errorhandler(AuthError)
    def _auth_error(error: AuthError):
        return (
            jsonify({"error": {"code": "unauthorized" if error.status == 401 else "forbidden", "message": error.message}}),
            error.status,
        )

    @app.errorhandler(ValidationError)
    def _validation_error(error: ValidationError):
        payload = {"code": "validation_error", "message": error.message}
        if error.field:
            payload["field"] = error.field
        return jsonify({"error": payload}), 400

    @app.errorhandler(HTTPException)
    def _http_error(error: HTTPException):
        return (
            jsonify(
                {
                    "error": {
                        "code": (error.name or "http_error").lower().replace(" ", "_"),
                        "message": error.description or error.name,
                    }
                }
            ),
            error.code or 500,
        )

    @app.errorhandler(Exception)
    def _unhandled_error(error: Exception):
        logger.exception("Unhandled error on %s %s", request.method, request.path)
        return (
            jsonify(
                {
                    "error": {
                        "code": "internal_error",
                        "message": "An unexpected error occurred. Check the server log for details.",
                    }
                }
            ),
            500,
        )

    @app.get("/")
    def index():
        return jsonify(
            {
                "name": "CloudPulse API",
                "tagline": "Monitor. Analyse. Optimise.",
                "version": config.get("API_VERSION"),
                "health": "/api/health",
                "docs": "/api/docs",
            }
        )

    with app.app_context():
        if config.get("AUTO_SEED", True):
            try:
                result = seed_database(store, config)
                logger.info("Seed result: %s", result)
            except Exception:  # noqa: BLE001
                logger.exception("Database seeding failed")

        settings = get_settings(store)
        if (
            not config.get("TESTING")
            and config.get("AUTO_SEED", True)
            and settings.get("anomaly_detection_enabled", True)
            and store.count("telemetry") > 0
            and store.count("detection_runs") == 0
        ):
            try:
                run = detect_and_store(store, settings, triggered_by="bootstrap", emit=False)
                logger.info("Bootstrap anomaly scan: %s", run.get("message"))
            except Exception:  # noqa: BLE001
                logger.exception("Bootstrap anomaly detection failed")

    runtime = create_runtime(app)
    app.extensions["cloudpulse_runtime"] = runtime
    logger.info("CloudPulse API ready")
    return app


__all__ = ["create_app", "socketio", "iso"]
