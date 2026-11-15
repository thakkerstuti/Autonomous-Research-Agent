"""Google OAuth 2.0 / OpenID Connect, authorization-code flow with PKCE.

- Authlib builds the authorization URL (state, nonce, S256 code challenge)
  and performs the code exchange with the client secret, server-side only.
- PyJWT verifies the returned ID token against Google's published signing
  keys: signature, issuer, audience (our client ID), expiry, and the nonce
  we generated for this login.
"""
import hmac

import jwt
from authlib.common.security import generate_token
from authlib.integrations.httpx_client import OAuth2Client

from app.auth import config

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")

_jwks_client = jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600)


class GoogleAuthError(Exception):
    pass


def _client() -> OAuth2Client:
    return OAuth2Client(
        client_id=config.GOOGLE_CLIENT_ID,
        client_secret=config.GOOGLE_CLIENT_SECRET,
        scope="openid email profile",
        redirect_uri=config.OAUTH_REDIRECT_URI,
        code_challenge_method="S256",
        timeout=10,
    )


def build_authorization_request() -> dict:
    """Returns the Google URL plus the secrets to remember until the callback."""
    state = generate_token(32)
    nonce = generate_token(32)
    code_verifier = generate_token(64)
    with _client() as client:
        url, _ = client.create_authorization_url(
            AUTHORIZE_URL,
            state=state,
            nonce=nonce,
            code_verifier=code_verifier,
            prompt="select_account",
        )
    return {"url": url, "state": state, "nonce": nonce, "code_verifier": code_verifier}


def exchange_code(code: str, code_verifier: str) -> dict:
    try:
        with _client() as client:
            return client.fetch_token(TOKEN_URL, code=code, code_verifier=code_verifier, grant_type="authorization_code")
    except Exception as exc:
        raise GoogleAuthError("token_exchange_failed") from exc


def _signing_key(id_token: str):
    return _jwks_client.get_signing_key_from_jwt(id_token).key


def verify_id_token(id_token: str, expected_nonce: str) -> dict:
    try:
        key = _signing_key(id_token)
        claims = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=config.GOOGLE_CLIENT_ID,
            options={"require": ["iss", "aud", "exp", "iat", "sub"]},
            leeway=60,
        )
    except Exception as exc:
        raise GoogleAuthError("invalid_id_token") from exc
    if claims.get("iss") not in ISSUERS:
        raise GoogleAuthError("invalid_issuer")
    if "azp" in claims and claims["azp"] != config.GOOGLE_CLIENT_ID:
        raise GoogleAuthError("invalid_azp")
    if not hmac.compare_digest(str(claims.get("nonce", "")), expected_nonce):
        raise GoogleAuthError("invalid_nonce")
    return claims
