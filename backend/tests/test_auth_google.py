"""Google OAuth flow with Google's two network calls replaced: the code
exchange returns an ID token we sign with a local RSA key, and the JWKS
lookup returns that key's public half. Everything else is the real code."""
import base64
import datetime as dt
import hashlib
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import models
from app.auth import config, google
from app.database import SessionLocal
from conftest import HEADERS, bearer, new_client, register

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def fake_google(monkeypatch):
    calls = {}

    def exchange(code, code_verifier):
        calls["verifier"] = code_verifier
        return {"id_token": calls["id_token"]}

    monkeypatch.setattr(google, "exchange_code", exchange)
    monkeypatch.setattr(google, "_signing_key", lambda token: KEY.public_key())
    return calls


def id_token(nonce, *, sub="google-sub-1", email="grace@gmail.com", verified=True, aud=None, iss="https://accounts.google.com",
             expires_in=3600, key=KEY):
    now = dt.datetime.now(dt.timezone.utc)
    return jwt.encode(
        {"iss": iss, "aud": aud or config.GOOGLE_CLIENT_ID, "sub": sub, "email": email, "email_verified": verified,
         "name": "Grace Hopper", "nonce": nonce, "iat": now, "exp": now + dt.timedelta(seconds=expires_in)},
        key, algorithm="RS256",
    )


def start(c, path="/auth/google/login?next=/research"):
    r = c.get(path, follow_redirects=False)
    assert r.status_code == 303, r.text
    loc = urlparse(r.headers["location"])
    q = {k: v[0] for k, v in parse_qs(loc.query).items()}
    return loc, q


def finish(c, fake, q, **token_kwargs):
    fake["id_token"] = id_token(token_kwargs.pop("nonce", q["nonce"]), **token_kwargs)
    return c.get(f"/auth/google/callback?code=abc&state={q['state']}", follow_redirects=False)


def test_authorization_request_uses_state_nonce_and_pkce(client, fake_google):
    loc, q = start(client)
    assert loc.netloc == "accounts.google.com"
    assert q["client_id"] == config.GOOGLE_CLIENT_ID and q["redirect_uri"] == config.OAUTH_REDIRECT_URI
    assert q["response_type"] == "code" and set(q["scope"].split()) == {"openid", "email", "profile"}
    assert q["code_challenge_method"] == "S256" and q["state"] and q["nonce"]
    assert "client_secret" not in loc.query  # the secret never goes to the browser

    finish(client, fake_google, q)
    expected = base64.urlsafe_b64encode(hashlib.sha256(fake_google["verifier"].encode()).digest()).rstrip(b"=").decode()
    assert expected == q["code_challenge"]


def test_google_signup_then_login_same_user(client, fake_google):
    _, q = start(client)
    r = finish(client, fake_google, q)
    assert r.status_code == 303 and r.headers["location"] == "http://localhost:3001/research"
    assert "cx_refresh=" in r.headers["set-cookie"]
    me = client.post("/auth/refresh", headers=HEADERS).json()["user"]
    assert me["email"] == "grace@gmail.com" and me["providers"] == ["google"] and me["has_password"] is False

    again = new_client()
    _, q2 = start(again)
    assert finish(again, fake_google, q2).status_code == 303
    assert again.post("/auth/refresh", headers=HEADERS).json()["user"]["id"] == me["id"]
    db = SessionLocal()
    assert db.query(models.User).count() == 1 and db.query(models.OAuthAccount).count() == 1
    db.close()


@pytest.mark.parametrize("kwargs", [
    {"aud": "someone-else.apps.googleusercontent.com"},
    {"iss": "https://evil.example"},
    {"expires_in": -3600},
    {"nonce": "not-the-nonce"},
    {"key": OTHER_KEY},
])
def test_invalid_id_tokens_are_rejected(client, fake_google, kwargs):
    _, q = start(client)
    r = finish(client, fake_google, q, **kwargs)
    assert r.status_code == 303 and r.headers["location"].endswith("/login?error=google_failed")
    db = SessionLocal()
    assert db.query(models.User).count() == 0
    db.close()


def test_state_mismatch_and_missing_state_cookie(client, fake_google):
    _, q = start(client)
    fake_google["id_token"] = id_token(q["nonce"])
    r = client.get("/auth/google/callback?code=abc&state=forged", follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=google_state")

    stranger = new_client()  # never started a login, so has no state cookie
    r = stranger.get(f"/auth/google/callback?code=abc&state={q['state']}", follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=google_state")


def test_unverified_google_email_is_refused(client, fake_google):
    _, q = start(client)
    r = finish(client, fake_google, q, verified=False)
    assert r.headers["location"].endswith("/login?error=google_unverified")


def test_existing_email_account_is_not_linked_automatically(client, fake_google):
    register(client, email="grace@gmail.com")
    g = new_client()
    _, q = start(g)
    r = finish(g, fake_google, q)
    assert r.headers["location"].endswith("/login?error=account_exists")
    assert "cx_refresh" not in r.headers.get("set-cookie", "")
    db = SessionLocal()
    assert db.query(models.OAuthAccount).count() == 0
    db.close()


def test_signed_in_user_can_link_google(client, fake_google):
    token = register(client, email="grace@gmail.com").json()["access_token"]
    intent = client.post("/auth/google/link-intent", headers={**HEADERS, **bearer(token)})
    assert intent.status_code == 200
    link_path = intent.json()["url"].replace(config.COOKIE_PATH, "/auth", 1)
    _, q = start(client, link_path)
    r = finish(client, fake_google, q)
    assert r.headers["location"] == "http://localhost:3001/settings?google=linked"
    me = client.get("/auth/me", headers=bearer(token)).json()
    assert me["providers"] == ["google"]

    # From now on Google signs straight into the same account
    g = new_client()
    _, q2 = start(g)
    finish(g, fake_google, q2)
    assert g.post("/auth/refresh", headers=HEADERS).json()["user"]["id"] == me["id"]


def test_leaked_link_ticket_is_useless_in_another_browser(client, fake_google):
    token = register(client, email="grace@gmail.com").json()["access_token"]
    url = client.post("/auth/google/link-intent", headers={**HEADERS, **bearer(token)}).json()["url"]
    attacker = new_client()  # has the ticket but not the victim's session cookie
    r = attacker.get(url.replace(config.COOKIE_PATH, "/auth", 1), follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=link_expired")

    other = new_client()  # signed in as someone else
    register(other, email="mallory@example.com")
    r = other.get(url.replace(config.COOKIE_PATH, "/auth", 1), follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=link_expired")


def test_auth_responses_are_not_cacheable(client):
    r = register(client)
    assert r.headers["cache-control"] == "no-store"
    assert client.post("/auth/refresh", headers=HEADERS).headers["cache-control"] == "no-store"


def test_link_requires_valid_ticket(client, fake_google):
    r = client.get("/auth/google/login?link=garbage", follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=link_expired")


def test_open_redirects_are_blocked(client, fake_google):
    for bad in ["//evil.example", "https://evil.example", "/\\evil.example"]:
        c = new_client()
        _, q = start(c, f"/auth/google/login?next={bad}")
        r = finish(c, fake_google, q)
        assert r.headers["location"] == "http://localhost:3001/dashboard"


def test_cancelled_consent(client):
    r = client.get("/auth/google/callback?error=access_denied", follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=google_cancelled")
