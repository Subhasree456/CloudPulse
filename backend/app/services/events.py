"""Emit real-time events through Flask-SocketIO when it is available."""
from __future__ import annotations

import logging

from flask import current_app

logger = logging.getLogger(__name__)


def emit_event(event: str, payload: dict, *, room: str | None = None) -> None:
    try:
        socketio = current_app.extensions.get("cloudpulse_socketio")
        if socketio is None:
            return
        socketio.emit(event, payload, room=room)
    except Exception as exc:  # noqa: BLE001 - real-time is best effort
        logger.debug("Socket emit failed for %s: %s", event, exc)
