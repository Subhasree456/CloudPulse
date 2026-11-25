"""JWT authentication, password hashing and role-based access helpers."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from .utils import iso, new_id, utcnow

ALGORITHM = "HS256"


class AuthError(Exception):
    def __init__(self, message: str = "Authentication required.", status: int = 401):
        super().__init__(message)
        self.message = message
        self.status = status


def hash_password(password: str) -> str:
    return generate_password_hash(password, method="scrypt")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return check_password_hash(password_hash, password)
    except (ValueError, TypeError):
        return False


def hash_agent_key(agent_key: str) -> str:
    return hashlib.sha256(agent_key.encode("utf-8")).hexdigest()


def generate_agent_key() -> tuple[str, str]:
    raw = "cp_live_" + secrets.token_urlsafe(32)
    return raw, hash_agent_key(raw)


def create_token(user: dict, expires_minutes: int | None = None) -> tuple[str, dict]:
    minutes = expires_minutes or current_app.config["JWT_EXPIRES_MINUTES"]
    now = utcnow()
    expires = now + timedelta(minutes=minutes)
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user.get("role", "viewer"),
        "jti": new_id(),
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    token = jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm=ALGORITHM)
    return token, {"expires_at": iso(expires), "jti": payload["jti"]}


def decode_token(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return jwt.decode(token, current_app.config["SECRET_KEY"], algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_bearer_token() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def authenticate(store, token: str | None = None) -> dict | None:
    token = token or get_bearer_token()
    payload = decode_token(token)
    if not payload:
        return None
    if store.find_one("revoked_tokens", {"jti": payload.get("jti")}):
        return None
    user = store.find_one("users", {"id": payload.get("sub")})
    if not user:
        return None
    return user


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        store = current_app.extensions["cloudpulse_store"]
        user = authenticate(store)
        if not user:
            raise AuthError()
        g.current_user = user
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if g.current_user.get("role") != "admin":
            raise AuthError("Administrator access is required.", 403)
        return view(*args, **kwargs)

    return wrapped


def socket_user(store, token: str | None):
    return authenticate(store, token)


def revoke_token(store, payload: dict) -> None:
    if not payload:
        return
    store.insert(
        "revoked_tokens",
        {
            "jti": payload.get("jti"),
            "user_id": payload.get("sub"),
            "expires_at": iso(utcnow() + timedelta(minutes=current_app.config["JWT_EXPIRES_MINUTES"])),
            "revoked_at": iso(),
        },
    )


def public_user(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "name": user.get("name"),
        "email": user.get("email"),
        "role": user.get("role", "viewer"),
        "created_at": user.get("created_at"),
        "last_login_at": user.get("last_login_at"),
    }


def constant_time_compare(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode(), right.encode())
