"""Authentication, session and RBAC tests."""
from __future__ import annotations


def test_health_is_public(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "ok"
    assert body["database"]["connected"] is True
    assert body["service"] == "cloudpulse-api"


def test_register_login_me_and_logout(client):
    registered = client.post(
        "/api/auth/register",
        json={"name": "Ada", "email": "ada@example.com", "password": "StrongPass1"},
    )
    assert registered.status_code == 201
    token = registered.get_json()["token"]
    assert registered.get_json()["user"]["role"] == "admin"

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.get_json()["user"]["email"] == "ada@example.com"

    logout = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout.status_code == 200
    revoked = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert revoked.status_code == 401

    login = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "StrongPass1"},
    )
    assert login.status_code == 200
    assert login.get_json()["token"]


def test_registration_validation(client):
    weak = client.post(
        "/api/auth/register",
        json={"name": "Weak", "email": "weak@example.com", "password": "password"},
    )
    assert weak.status_code == 400
    assert weak.get_json()["error"]["field"] == "password"

    bad_email = client.post(
        "/api/auth/register",
        json={"name": "Bad", "email": "not-an-email", "password": "GoodPass123"},
    )
    assert bad_email.status_code == 400
    assert bad_email.get_json()["error"]["field"] == "email"


def test_duplicate_email_rejected(client):
    payload = {"name": "One", "email": "same@example.com", "password": "SamePass123"}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    duplicate = client.post("/api/auth/register", json=payload)
    assert duplicate.status_code == 400
    assert "already exists" in duplicate.get_json()["error"]["message"]


def test_invalid_login(client):
    response = client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "NoPass12345"},
    )
    assert response.status_code == 401
    assert response.get_json()["error"]["message"] == "Invalid email or password."


def test_role_based_access(client, users):
    viewer_create = client.post(
        "/api/servers",
        headers=users["viewer_headers"],
        json={"name": "forbidden", "hostname": "forbidden.internal"},
    )
    assert viewer_create.status_code == 403

    users_response = client.get("/api/auth/users", headers=users["admin_headers"])
    assert users_response.status_code == 200
    assert len(users_response.get_json()["items"]) == 2

    forbidden_users = client.get("/api/auth/users", headers=users["viewer_headers"])
    assert forbidden_users.status_code == 403


def test_profile_and_password_update(client, users):
    headers = users["viewer_headers"]
    updated = client.put(
        "/api/auth/profile",
        headers=headers,
        json={"name": "Viewer Renamed"},
    )
    assert updated.status_code == 200
    assert updated.get_json()["user"]["name"] == "Viewer Renamed"

    wrong = client.post(
        "/api/auth/password",
        headers=headers,
        json={"current_password": "WrongPass1", "new_password": "NewViewer123"},
    )
    assert wrong.status_code == 400

    changed = client.post(
        "/api/auth/password",
        headers=headers,
        json={"current_password": "ViewerPass123", "new_password": "NewViewer123"},
    )
    assert changed.status_code == 200
    new_token = changed.get_json()["token"]

    old_session = client.get("/api/auth/me", headers=headers)
    assert old_session.status_code == 401
    new_session = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_token}"})
    assert new_session.status_code == 200


def test_protected_endpoint_requires_token(client):
    assert client.get("/api/dashboard/overview").status_code == 401
    assert client.get("/api/servers").status_code == 401
    assert client.get("/api/alerts").status_code == 401
