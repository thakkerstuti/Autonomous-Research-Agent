"""Authentication settings, read from environment variables only.

No secret has a default. In development (no RENDER / APP_ENV=production) a
random signing key is generated per process so the app still runs locally;
in production a missing JWT_SECRET disables authentication instead.
"""
import os
import secrets
import logging

from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(BASE_DIR, ".env"))
load_dotenv()

log = logging.getLogger("cognexa.auth")

IS_PRODUCTION = os.getenv("APP_ENV", "").lower() == "production" or os.getenv("RENDER", "").lower() == "true"

_jwt_secret = os.getenv("JWT_SECRET", "")
if not _jwt_secret and not IS_PRODUCTION:
    _jwt_secret = secrets.token_urlsafe(48)
    log.warning("JWT_SECRET is not set; using a temporary development key (sessions reset on restart).")
JWT_SECRET: str = _jwt_secret
AUTH_CONFIGURED: bool = bool(JWT_SECRET) and len(JWT_SECRET) >= 32

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "cognexa"
JWT_AUDIENCE = "cognexa-api"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "15"))
REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "30"))
# A refresh token reused within this window after rotation is treated as a
# benign race (two tabs refreshing at once), not as theft.
REFRESH_REUSE_GRACE_SECONDS = 30
RESET_TOKEN_MINUTES = 30

# The browser reaches /auth/* through the frontend's own origin
# (Next.js rewrite /backend/auth/* -> this API), so the refresh cookie is
# first-party on the frontend domain. Its path is the browser-side path.
COOKIE_PATH = os.getenv("AUTH_COOKIE_PATH", "/backend/auth")
COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "true" if IS_PRODUCTION else "false").lower() == "true"
REFRESH_COOKIE = "cx_refresh"
OAUTH_STATE_COOKIE = "cx_oauth"

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3001").rstrip("/")
ALLOWED_ORIGINS = [
    o.strip().rstrip("/")
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:3001,http://127.0.0.1:3001,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]
if FRONTEND_URL not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(FRONTEND_URL)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
OAUTH_REDIRECT_URI = os.getenv("OAUTH_REDIRECT_URI", "")
GOOGLE_CONFIGURED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and OAUTH_REDIRECT_URI)

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USERNAME)
SMTP_CONFIGURED = bool(SMTP_HOST and SMTP_FROM)
