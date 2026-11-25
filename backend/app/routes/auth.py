"""Authentication and user profile endpoints."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from flask import Blueprint, current_app, g, jsonify, request

from ..auth import (
    AuthError,
    admin_required,
    create_token,
    decode_token,
    hash_password,
    login_required,
    public_user,
    revoke_token,
    verify_password,
)
from ..utils import (
    ValidationError,
    email_field,
    iso,
    new_id,
    password_field,
    require_json,
    text_field,
    utcnow,
)

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

_login_attempts: dict[str, deque] = defaultdict(lambda: deque(maxlen=20))
_LOGIN_WINDOW = 300
_LOGIN_LIMIT = 10


def _key() -> str:
    return f"{request.remote_addr}|{(request.get_json(silent=True) or {}).get('email', '').lower()}"


def _check_rate_limit(key: str) -> None:
    now = time.time()
    attempts = _login_attempts[key]
    while attempts and now - attempts[0] > _LOGIN_WINDOW:
        attempts.popleft()
    if len(attempts) >= _LOGIN_LIMIT:
        raise AuthError("Too many login attempts. Please wait a few minutes and try again.", 429)


def _store():
    return current_app.extensions["cloudpulse_store"]


@bp.post("/register")
def register():
    data = require_json()
    name = text_field(data, "name", required_field=True, max_length=80, label="Name")
    email = email_field(data)
    password = password_field(data)
    store = _store()
    if store.find_one("users", {"email": email}):
        raise ValidationError("An account with this email already exists.", "email")
    first_user = store.count("users") == 0
    now = iso()
    user = {
        "id": new_id("user_"),
        "name": name,
        "email": email,
        "password_hash": hash_password(password),
        "role": "admin" if first_user else "viewer",
        "created_at": now,
        "updated_at": now,
        "last_login_at": now,
    }
    user = store.insert("users", user)
    token, meta = create_token(user)
    return (
        jsonify(
            {
                "token": token,
                "expires_at": meta["expires_at"],
                "user": public_user(user),
            }
        ),
        201,
    )


@bp.post("/login")
def login():
    data = require_json()
    email = text_field(data, "email", required_field=True, max_length=254).lower()
    password = text_field(data, "password", required_field=True, max_length=128)
    key = _key()
    _check_rate_limit(key)
    store = _store()
    user = store.find_one("users", {"email": email})
    if not user or not verify_password(password, user.get("password_hash", "")):
        _login_attempts[key].append(time.time())
        raise AuthError("Invalid email or password.", 401)
    _login_attempts.pop(key, None)
    user["last_login_at"] = iso()
    user["updated_at"] = iso()
    user = store.update("users", {"id": user["id"]}, user) or user
    token, meta = create_token(user)
    return jsonify(
        {
            "token": token,
            "expires_at": meta["expires_at"],
            "user": public_user(user),
        }
    )


@bp.post("/logout")
@login_required
def logout():
    token = None
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    revoke_token(_store(), decode_token(token))
    return jsonify({"message": "Signed out."})


@bp.get("/me")
@login_required
def me():
    return jsonify({"user": public_user(g.current_user)})


@bp.put("/profile")
@login_required
def update_profile():
    data = require_json()
    store = _store()
    user = g.current_user
    changed = False
    if "name" in data:
        user["name"] = text_field(data, "name", required_field=True, max_length=80, label="Name")
        changed = True
    if "email" in data:
        email = email_field(data)
        existing = store.find_one("users", {"email": email})
        if existing and existing["id"] != user["id"]:
            raise ValidationError("An account with this email already exists.", "email")
        user["email"] = email
        changed = True
    if changed:
        user["updated_at"] = iso()
        user = store.update("users", {"id": user["id"]}, user) or user
    return jsonify({"user": public_user(user)})


@bp.post("/password")
@login_required
def change_password():
    data = require_json()
    current_password = text_field(data, "current_password", required_field=True, max_length=128)
    new_password = password_field(data, "new_password")
    store = _store()
    user = g.current_user
    if not verify_password(current_password, user.get("password_hash", "")):
        raise ValidationError("Current password is incorrect.", "current_password")
    if current_password == new_password:
        raise ValidationError("The new password must be different from the current password.", "new_password")
    user["password_hash"] = hash_password(new_password)
    user["updated_at"] = iso()
    store.update("users", {"id": user["id"]}, user)
    # Invalidate every previously issued token for this user.
    token = None
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
    revoke_token(store, decode_token(token))
    new_token, meta = create_token(user)
    return jsonify(
        {
            "message": "Password updated. Other sessions must sign in again.",
            "token": new_token,
            "expires_at": meta["expires_at"],
            "user": public_user(user),
        }
    )


@bp.get("/users")
@admin_required
def list_users():
    users = _store().find("users", {}, sort=[("created_at", -1)], limit=200)
    return jsonify({"items": [public_user(user) for user in users], "total": len(users)})
