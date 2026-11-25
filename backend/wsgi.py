"""Production WSGI application for Render/gunicorn.

Render start command:
    gunicorn --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:$PORT wsgi:app

A single process is intentional: the in-process telemetry scheduler and
Socket.IO broadcaster must not be duplicated across workers.
"""
from app import create_app

app = create_app()
