"""Shared helpers: time, validation, pagination and range parsing."""
from __future__ import annotations

import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr

from flask import abort, request


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    value = value or utcnow()
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        cleaned = value.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(cleaned)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def new_id(prefix: str = "") -> str:
    value = uuid.uuid4().hex
    return f"{prefix}{value}" if prefix else value


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def round_or_none(value: float | None, digits: int = 2):
    if value is None:
        return None
    return round(float(value), digits)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


class ValidationError(ValueError):
    """Raised for invalid input; translated to HTTP 400 by the error handler."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field


def require_json() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ValidationError("A JSON object body is required.")
    return data


def required(data: dict, field: str, label: str | None = None) -> str:
    value = data.get(field)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise ValidationError(f"{label or field.replace('_', ' ').title()} is required.", field)
    return value


def text_field(
    data: dict,
    field: str,
    *,
    required_field: bool = False,
    max_length: int = 200,
    label: str | None = None,
    default: str = "",
) -> str:
    value = data.get(field, default)
    if value is None:
        value = default
    if not isinstance(value, str):
        raise ValidationError(f"{label or field} must be text.", field)
    value = value.strip()
    if required_field and not value:
        raise ValidationError(f"{label or field} is required.", field)
    if len(value) > max_length:
        raise ValidationError(f"{label or field} must be at most {max_length} characters.", field)
    return value


def number_field(
    data: dict,
    field: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
    required_field: bool = False,
    default: float | None = None,
) -> float | None:
    value = data.get(field, default)
    if value is None or value == "":
        if required_field:
            raise ValidationError(f"{field.replace('_', ' ').title()} is required.", field)
        return None
    if isinstance(value, bool):
        raise ValidationError(f"{field} must be a number.", field)
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{field} must be a number.", field) from None
    if not math.isfinite(numeric):
        raise ValidationError(f"{field} must be a finite number.", field)
    if minimum is not None and numeric < minimum:
        raise ValidationError(f"{field} must be at least {minimum}.", field)
    if maximum is not None and numeric > maximum:
        raise ValidationError(f"{field} must be at most {maximum}.", field)
    return numeric


def email_field(data: dict, field: str = "email") -> str:
    value = text_field(data, field, required_field=True, max_length=254).lower()
    if not EMAIL_RE.match(value):
        raise ValidationError("Enter a valid email address.", field)
    return value


def bool_field(data: dict, field: str, default: bool = False) -> bool:
    value = data.get(field, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def password_field(data: dict, field: str = "password") -> str:
    value = data.get(field, "")
    if not isinstance(value, str) or len(value) < 8:
        raise ValidationError("Password must be at least 8 characters.", field)
    if len(value) > 128:
        raise ValidationError("Password must be at most 128 characters.", field)
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValidationError("Password must include at least one letter and one number.", field)
    return value


def validate_origin(value: str | None) -> bool:
    if not value:
        return False
    return parseaddr(value) is not None


# ---------------------------------------------------------------------------
# Pagination / range parsing
# ---------------------------------------------------------------------------
RANGE_SECONDS = {
    "5m": 5 * 60,
    "15m": 15 * 60,
    "30m": 30 * 60,
    "1h": 60 * 60,
    "6h": 6 * 60 * 60,
    "12h": 12 * 60 * 60,
    "24h": 24 * 60 * 60,
    "7d": 7 * 24 * 60 * 60,
    "30d": 30 * 24 * 60 * 60,
}


def parse_range(args=None) -> dict:
    """Parse ?range=24h or ?from=...&to=... into a bounded window."""
    args = args or request.args
    now = utcnow()
    raw_range = (args.get("range") or "24h").strip().lower()
    from_raw = args.get("from")
    to_raw = args.get("to")

    if from_raw or to_raw:
        end = parse_iso(to_raw) or now
        start = parse_iso(from_raw) or (end - timedelta(hours=24))
        if start >= end:
            raise ValidationError("The start of the range must be before the end.")
        if (end - start) > timedelta(days=90):
            raise ValidationError("Custom ranges are limited to 90 days.")
        seconds = int((end - start).total_seconds())
        label = "custom"
    else:
        if raw_range not in RANGE_SECONDS:
            raise ValidationError(
                "range must be one of: " + ", ".join(RANGE_SECONDS.keys())
            )
        seconds = RANGE_SECONDS[raw_range]
        end = now
        start = end - timedelta(seconds=seconds)
        label = raw_range

    bucket = max(5, min(3600, int(math.ceil(seconds / 60 / 1.0))))
    return {
        "start": start,
        "end": end,
        "seconds": seconds,
        "label": label,
        "bucket_seconds": bucket,
        "start_iso": iso(start),
        "end_iso": iso(end),
    }


def pagination(args=None) -> tuple[int, int]:
    args = args or request.args
    try:
        page = max(1, int(args.get("page", "1")))
        limit = max(1, min(500, int(args.get("limit", "50"))))
    except (TypeError, ValueError):
        raise ValidationError("page and limit must be integers.") from None
    return page, limit


def abort_json(message: str, status: int = 400, code: str = "bad_request"):
    abort(status, description=message, code=code)


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------
def mb_to_bytes(mb: float | None) -> int:
    return int((mb or 0) * 1024 * 1024)
