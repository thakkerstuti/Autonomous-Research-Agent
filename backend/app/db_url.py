"""Database URL handling for SQLite and PostgreSQL (e.g. the Supabase session pooler).

Kept separate from app/database.py so the engine module changes as little as
possible. Used by app/database.py and by Alembic (alembic/env.py), so the app
and its migrations always talk to the same database.

Settings (environment or backend/.env):
- DATABASE_URL: the database. Unset means the local SQLite file backend/cognexa.db.
- DATABASE_DRIVER: "psycopg" (default; psycopg 3, used on Render) or "pg8000"
  (pure Python, for machines where psycopg's native libpq can't load, e.g.
  Windows Application Control).
- DATABASE_SSL_ROOT_CERT: optional path to a CA certificate to trust for the
  database (e.g. Supabase's root certificate). With it, psycopg verifies the
  server certificate too (sslmode=verify-full).

pg8000 always verifies the server certificate and host name. Credentials never
appear in logs: use describe_database_url().
"""
import os
import ssl
from urllib.parse import quote, unquote

from dotenv import load_dotenv
from sqlalchemy.engine import URL, make_url

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "cognexa.db")

# backend/.env, whichever module (or Alembic) imports this first. Variables that
# are already set (Render's settings, the test setup) are never overridden.
load_dotenv(os.path.join(BASE_DIR, ".env"))

_POSTGRES_DRIVERS = {"postgres", "postgresql", "postgresql+psycopg", "postgresql+psycopg2", "postgresql+pg8000"}
_DRIVERS = {"psycopg", "pg8000"}
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
SUPABASE_TRANSACTION_POOLER_PORT = 6543


def _encode_password(raw: str) -> str:
    """Make the password in scheme://user:password@host/... URL-safe.

    Passwords copied into a URL often contain unencoded characters such as @.
    The host never contains @, so the last @ before the path or query is the
    separator; everything between the first : of the user part and it is the
    password. Already-encoded passwords are left as they are (decode, then encode).
    """
    if "://" not in raw:
        return raw
    scheme, rest = raw.split("://", 1)
    head = rest.split("?", 1)[0]
    at = head.rfind("@")
    if at < 0:
        return raw
    userinfo, after = rest[:at], rest[at + 1:]
    if ":" not in userinfo:
        return raw
    user, password = userinfo.split(":", 1)
    return f"{scheme}://{user}:{quote(unquote(password), safe='')}@{after}"


def get_driver(driver: str | None = None) -> str:
    d = (driver or os.getenv("DATABASE_DRIVER") or "psycopg").strip().lower()
    if d not in _DRIVERS:
        raise ValueError(f"DATABASE_DRIVER must be one of {sorted(_DRIVERS)}")
    return d


def normalise_database_url(raw: str | None, driver: str | None = None) -> str:
    """The URL SQLAlchemy should use.

    - empty: the local SQLite fallback
    - postgres:// or postgresql:// (any driver): postgresql+<DATABASE_DRIVER>://
    - psycopg, remote host: TLS required (sslmode=require, or verify-full with
      DATABASE_SSL_ROOT_CERT); pg8000 gets a verifying SSL context instead
      (see engine_options), so libpq-only query options are removed
    Anything else (e.g. sqlite:///...) is returned as given.
    """
    raw = (raw or "").strip()
    if not raw:
        return f"sqlite:///{DEFAULT_DB_PATH}"
    if raw.split("://", 1)[0] in _POSTGRES_DRIVERS:
        raw = _encode_password(raw)
    url = make_url(raw)
    if url.drivername not in _POSTGRES_DRIVERS:
        return url.render_as_string(hide_password=False)

    d = get_driver(driver)
    url = url.set(drivername=f"postgresql+{d}")
    remote = (url.host or "") not in _LOCAL_HOSTS
    if d == "pg8000":
        url = url.difference_update_query(["sslmode", "sslrootcert", "sslcert", "sslkey"])
    elif remote and "sslmode" not in url.query:
        root = os.getenv("DATABASE_SSL_ROOT_CERT", "").strip()
        url = url.update_query_dict({"sslmode": "verify-full", "sslrootcert": root} if root else {"sslmode": "require"})
    return url.render_as_string(hide_password=False)


def get_database_url() -> str:
    """The configured database URL, read from the environment at call time."""
    return normalise_database_url(os.getenv("DATABASE_URL"))


def is_sqlite(url: str | URL) -> bool:
    return make_url(url).get_backend_name() == "sqlite"


def describe_database_url(url: str | URL) -> str:
    """A credential-free description, safe for logs."""
    u = make_url(url)
    if u.get_backend_name() == "sqlite":
        return "sqlite (local file)"
    port = f":{u.port}" if u.port else ""
    return f"{u.get_backend_name()}+{u.get_driver_name()} (host={u.host}{port}, database={u.database})"


def verified_ssl_context() -> ssl.SSLContext:
    """TLS with certificate and host-name verification (never relaxed).

    Trusts DATABASE_SSL_ROOT_CERT when set (e.g. Supabase's root certificate),
    otherwise the system's trusted certificate authorities.
    """
    root = os.getenv("DATABASE_SSL_ROOT_CERT", "").strip() or None
    ctx = ssl.create_default_context(cafile=root)
    ctx.check_hostname = True
    ctx.verify_mode = ssl.CERT_REQUIRED
    return ctx


def engine_options(url: str | URL) -> dict:
    """create_engine() options for this kind of database."""
    u = make_url(url)
    if u.get_backend_name() == "sqlite":
        # SQLite connections are shared with the background worker threads
        return {"connect_args": {"check_same_thread": False}}
    options: dict = {
        # Supabase poolers close idle connections: check before use, recycle often,
        # and keep the pool small (the session pooler limits clients per project)
        "pool_pre_ping": True,
        "pool_size": 5,
        "max_overflow": 5,
        "pool_recycle": 300,
    }
    remote = (u.host or "") not in _LOCAL_HOSTS
    if u.get_driver_name() == "pg8000":
        if remote:
            options["connect_args"] = {"ssl_context": verified_ssl_context()}
    elif u.port == SUPABASE_TRANSACTION_POOLER_PORT:
        # The transaction pooler can't keep prepared statements between transactions
        options["connect_args"] = {"prepare_threshold": None}
    return options
