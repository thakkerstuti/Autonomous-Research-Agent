import datetime as dt

import jwt

from app import models
from app.auth import config, routes, tokens
from app.database import SessionLocal
from conftest import HEADERS, bearer, new_client, register


def _db():
    return SessionLocal()


# ───────── registration ─────────

def test_register_creates_user_with_argon2_hash_and_session(client):
    r = register(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["access_token"] and body["token_type"] == "bearer"
    assert body["user"]["email"] == "ada@example.com"
    assert body["user"]["has_password"] is True

    cookie = r.headers["set-cookie"]
    assert "cx_refresh=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/auth" in cookie

    db = _db()
    user = db.query(models.User).one()
    assert user.password_hash.startswith("$argon2id$")
    assert "correct horse battery" not in user.password_hash
    # Only a hash of the refresh token is stored
    raw = client.cookies.get("cx_refresh")
    stored = db.query(models.RefreshToken).one()
    assert stored.token_hash == tokens.sha256(raw) and stored.token_hash != raw
    db.close()


def test_register_validates_email_and_password(client):
    assert register(client, email="not-an-email").status_code == 400
    r = register(client, password="short")
    assert r.status_code == 400 and "at least 10" in r.json()["detail"]


def test_duplicate_registration_is_rejected_case_insensitively(client):
    assert register(client).status_code == 201
    r = register(new_client(), email="ADA@Example.com")
    assert r.status_code == 409
    db = _db()
    assert db.query(models.User).count() == 1
    db.close()


# ───────── login ─────────

def test_login_success_and_wrong_password(client):
    register(client)
    c = new_client()
    ok = c.post("/auth/login", json={"email": "ada@example.com", "password": "correct horse battery"}, headers=HEADERS)
    assert ok.status_code == 200 and ok.json()["access_token"]

    bad = c.post("/auth/login", json={"email": "ada@example.com", "password": "wrong password!"}, headers=HEADERS)
    unknown = c.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong password!"}, headers=HEADERS)
    assert bad.status_code == unknown.status_code == 401
    # Same message either way, so login doesn't reveal which emails are registered
    assert bad.json()["detail"] == unknown.json()["detail"] == "Email or password is incorrect."


def test_login_rate_limited_per_email(client):
    register(client)
    c = new_client()
    codes = [
        c.post("/auth/login", json={"email": "ada@example.com", "password": "wrong password!"}, headers=HEADERS).status_code
        for _ in range(11)
    ]
    assert codes[:10] == [401] * 10 and codes[10] == 429


# ───────── access tokens ─────────

def test_me_requires_valid_unexpired_token(client):
    token = register(client).json()["access_token"]
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers=bearer(token)).json()["email"] == "ada@example.com"
    assert client.get("/auth/me", headers=bearer(token[:-3] + "abc")).status_code == 401

    uid = client.get("/auth/me", headers=bearer(token)).json()["id"]
    past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
    expired = jwt.encode(
        {"sub": uid, "typ": "access", "iss": config.JWT_ISSUER, "aud": config.JWT_AUDIENCE,
         "iat": past - dt.timedelta(minutes=15), "exp": past},
        config.JWT_SECRET, algorithm="HS256",
    )
    r = client.get("/auth/me", headers=bearer(expired))
    assert r.status_code == 401 and "expired" in r.json()["detail"]

    forged = jwt.encode({"sub": uid, "typ": "access", "iss": config.JWT_ISSUER, "aud": config.JWT_AUDIENCE,
                         "iat": dt.datetime.now(dt.timezone.utc), "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)},
                        "some-other-secret-that-is-long-enough!!", algorithm="HS256")
    assert client.get("/auth/me", headers=bearer(forged)).status_code == 401


# ───────── refresh rotation ─────────

def test_refresh_rotates_and_detects_reuse(client, monkeypatch):
    register(client)
    first = client.cookies.get("cx_refresh")
    r = client.post("/auth/refresh", headers=HEADERS)
    assert r.status_code == 200 and r.json()["access_token"]
    second = client.cookies.get("cx_refresh")
    assert second and second != first

    # Replaying the old token after the grace window revokes the whole family
    monkeypatch.setattr(config, "REFRESH_REUSE_GRACE_SECONDS", -1)
    attacker = new_client()
    attacker.cookies.set("cx_refresh", first, path="/auth")
    assert attacker.post("/auth/refresh", headers=HEADERS).status_code == 401
    assert client.post("/auth/refresh", headers=HEADERS).status_code == 401  # legitimate one is dead too


def test_refresh_reuse_inside_grace_window_is_tolerated(client):
    register(client)
    first = client.cookies.get("cx_refresh")
    assert client.post("/auth/refresh", headers=HEADERS).status_code == 200
    other_tab = new_client()
    other_tab.cookies.set("cx_refresh", first, path="/auth")
    assert other_tab.post("/auth/refresh", headers=HEADERS).status_code == 200
    assert client.post("/auth/refresh", headers=HEADERS).status_code == 200


def test_expired_refresh_token_is_rejected(client):
    register(client)
    db = _db()
    db.query(models.RefreshToken).update({"expires_at": tokens.utcnow() - dt.timedelta(seconds=1)})
    db.commit()
    db.close()
    r = client.post("/auth/refresh", headers=HEADERS)
    assert r.status_code == 401
    assert 'cx_refresh=""' in r.headers.get("set-cookie", "")  # cookie cleared


def test_refresh_without_cookie(client):
    assert client.post("/auth/refresh", headers=HEADERS).status_code == 401


# ───────── logout ─────────

def test_logout_revokes_session(client):
    register(client)
    r = client.post("/auth/logout", headers=HEADERS)
    assert r.status_code == 204
    assert 'cx_refresh=""' in r.headers.get("set-cookie", "")
    stale = new_client()
    db = _db()
    rec = db.query(models.RefreshToken).one()
    assert rec.revoked_reason == "logout"
    db.close()
    assert client.post("/auth/refresh", headers=HEADERS).status_code == 401


def test_logout_all_revokes_every_device(client):
    token = register(client).json()["access_token"]
    laptop = new_client()
    laptop.post("/auth/login", json={"email": "ada@example.com", "password": "correct horse battery"}, headers=HEADERS)
    assert client.post("/auth/logout-all", headers={**HEADERS, **bearer(token)}).status_code == 204
    assert laptop.post("/auth/refresh", headers=HEADERS).status_code == 401


# ───────── CSRF / origin ─────────

def test_untrusted_origin_and_missing_csrf_header_are_refused(client):
    body = {"email": "x@example.com", "password": "correct horse battery"}
    evil = client.post("/auth/register", json=body, headers={"Origin": "https://evil.example", "X-CogNexa-Auth": "1"})
    assert evil.status_code == 403
    no_header = client.post("/auth/register", json=body, headers={"Origin": "http://localhost:3001"})
    assert no_header.status_code == 403
    register(client)
    assert client.post("/auth/refresh", headers={"Origin": "https://evil.example", "X-CogNexa-Auth": "1"}).status_code == 403
    assert client.post("/auth/logout", headers={"Origin": "https://evil.example", "X-CogNexa-Auth": "1"}).status_code == 403


def test_cors_allows_only_configured_origin(client):
    ok = client.options("/papers", headers={"Origin": "http://localhost:3001", "Access-Control-Request-Method": "GET",
                                            "Access-Control-Request-Headers": "authorization"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3001"
    other = client.options("/papers", headers={"Origin": "https://someone-else.vercel.app", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in other.headers


# ───────── forgot / reset ─────────

def test_forgot_and_reset_password(client, monkeypatch):
    sent = []
    monkeypatch.setattr(routes, "send_password_reset", lambda to, url: sent.append((to, url)))
    register(client)

    unknown = client.post("/auth/forgot-password", json={"email": "nobody@example.com"}, headers=HEADERS)
    known = client.post("/auth/forgot-password", json={"email": "ada@example.com"}, headers=HEADERS)
    assert unknown.status_code == known.status_code == 202
    assert unknown.json() == known.json()  # no account enumeration
    assert len(sent) == 1 and sent[0][0] == "ada@example.com"
    token = sent[0][1].split("token=")[1]

    db = _db()
    assert db.query(models.AuthToken).one().token_hash == tokens.sha256(token)
    db.close()

    assert client.post("/auth/reset-password", json={"token": token, "password": "short"}, headers=HEADERS).status_code == 400
    r = client.post("/auth/reset-password", json={"token": token, "password": "a brand new passphrase"}, headers=HEADERS)
    assert r.status_code == 200
    # Single use
    assert client.post("/auth/reset-password", json={"token": token, "password": "another passphrase!"}, headers=HEADERS).status_code == 400
    # Existing sessions were revoked
    assert client.post("/auth/refresh", headers=HEADERS).status_code == 401

    c = new_client()
    old = c.post("/auth/login", json={"email": "ada@example.com", "password": "correct horse battery"}, headers=HEADERS)
    new = c.post("/auth/login", json={"email": "ada@example.com", "password": "a brand new passphrase"}, headers=HEADERS)
    assert old.status_code == 401 and new.status_code == 200


def test_expired_and_superseded_reset_links_fail(client, monkeypatch):
    sent = []
    monkeypatch.setattr(routes, "send_password_reset", lambda to, url: sent.append(url))
    register(client)
    client.post("/auth/forgot-password", json={"email": "ada@example.com"}, headers=HEADERS)
    client.post("/auth/forgot-password", json={"email": "ada@example.com"}, headers=HEADERS)
    first, second = (u.split("token=")[1] for u in sent)
    assert client.post("/auth/reset-password", json={"token": first, "password": "a brand new passphrase"}, headers=HEADERS).status_code == 400

    db = _db()
    db.query(models.AuthToken).update({"expires_at": tokens.utcnow() - dt.timedelta(seconds=1)})
    db.commit()
    db.close()
    assert client.post("/auth/reset-password", json={"token": second, "password": "a brand new passphrase"}, headers=HEADERS).status_code == 400


def test_update_profile_name(client):
    token = register(client).json()["access_token"]
    r = client.patch("/auth/me", json={"name": "  Ada   Lovelace "}, headers={**HEADERS, **bearer(token)})
    assert r.status_code == 200 and r.json()["name"] == "Ada Lovelace"



def test_cors_preflight_allows_every_method_the_api_uses(client):
    """Production calls the API cross-origin (Vercel to Render), so every route
    method must pass the browser preflight. PUT was once missing, and flashcard
    progress failed in the browser with "Failed to fetch"."""
    spec = client.get("/openapi.json").json()
    methods = {m.upper() for ops in spec["paths"].values() for m in ops}
    assert "PUT" in methods
    for method in sorted(methods):
        r = client.options("/papers/x/study/flashcards/progress", headers={
            "Origin": "http://localhost:3001", "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "authorization,content-type"})
        assert r.status_code == 200, method
        assert method in r.headers["access-control-allow-methods"], method
