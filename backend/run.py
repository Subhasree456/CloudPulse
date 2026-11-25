"""WSGI entrypoint used by gunicorn and the development runner."""
from __future__ import annotations

import os

from app import create_app, socketio

app = create_app()

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    debug = app.config.get("DEBUG", False) and app.config.get("ENVIRONMENT") != "production"
    socketio.run(
        app,
        host=host,
        port=port,
        debug=debug,
        use_reloader=False,
        allow_unsafe_werkzeug=True,
    )
