"""Central configuration for CloudPulse.

All values can be overridden with environment variables. No secrets are ever
hard-coded into the application; the development secret is generated once and
stored in the data directory so that tokens survive a restart.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BASE_DIR.parent

load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _list(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _dev_secret(data_dir: Path) -> str:
    """Generate and persist a development secret (never used in production)."""
    data_dir.mkdir(parents=True, exist_ok=True)
    secret_file = data_dir / ".dev-secret"
    if secret_file.exists():
        return secret_file.read_text(encoding="utf-8").strip()
    value = secrets.token_urlsafe(48)
    secret_file.write_text(value, encoding="utf-8")
    return value


def load_config() -> dict:
    data_dir = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data"))).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    environment = os.getenv("APP_ENV", os.getenv("FLASK_ENV", "development")).lower()
    secret_key = os.getenv("SECRET_KEY")
    generated_secret = False
    if not secret_key:
        if environment == "production":
            raise RuntimeError(
                "SECRET_KEY must be set in production. Generate one with "
                "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"`."
            )
        secret_key = _dev_secret(data_dir)
        generated_secret = True

    allowed_origins = _list(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    )

    return {
        "ENVIRONMENT": environment,
        "DEBUG": _bool("FLASK_DEBUG", environment == "development"),
        "TESTING": _bool("TESTING", False),
        "SECRET_KEY": secret_key,
        "GENERATED_SECRET": generated_secret,
        "JWT_EXPIRES_MINUTES": _int("JWT_EXPIRES_MINUTES", 12 * 60),
        "MONGO_URI": os.getenv("MONGO_URI", "").strip(),
        "MONGO_DB": os.getenv("MONGO_DB", "cloudpulse"),
        "DATA_DIR": str(data_dir),
        "DATABASE_PATH": os.getenv("DATABASE_PATH", str(data_dir / "cloudpulse.sqlite")),
        "ALLOWED_ORIGINS": allowed_origins,
        "AUTO_SEED": _bool("AUTO_SEED", True),
        "SEED_DEMO_DATA": _bool("SEED_DEMO_DATA", True),
        "SEED_ADMIN_EMAIL": os.getenv("SEED_ADMIN_EMAIL", "admin@cloudpulse.dev"),
        "SEED_ADMIN_PASSWORD": os.getenv("SEED_ADMIN_PASSWORD", "Admin@12345"),
        "SEED_ADMIN_NAME": os.getenv("SEED_ADMIN_NAME", "Alex Morgan"),
        "DEMO_MODE_DEFAULT": os.getenv("DEMO_MODE_DEFAULT", "demo"),
        "MONITORING_INTERVAL": _int("MONITORING_INTERVAL", 5),
        "OFFLINE_AFTER_SECONDS": _int("OFFLINE_AFTER_SECONDS", 30),
        "ENABLE_LOCAL_COLLECTOR": _bool("ENABLE_LOCAL_COLLECTOR", True),
        "ENABLE_BACKGROUND_WORKERS": _bool("ENABLE_BACKGROUND_WORKERS", True),
        "AGENT_ENROLLMENT_TOKEN": os.getenv("AGENT_ENROLLMENT_TOKEN", "").strip(),
        "RETENTION_DAYS": _int("RETENTION_DAYS", 30),
        "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO").upper(),
        "LOG_DIR": os.getenv("LOG_DIR", str(data_dir / "logs")),
        "MAX_CONTENT_LENGTH": _int("MAX_CONTENT_LENGTH", 1024 * 1024),
        "ANOMALY_INTERVAL_MINUTES": _int("ANOMALY_INTERVAL_MINUTES", 10),
        "API_VERSION": "1.0.0",
        "APP_NAME": "CloudPulse",
        "PROJECT_DIR": str(PROJECT_DIR),
    }
