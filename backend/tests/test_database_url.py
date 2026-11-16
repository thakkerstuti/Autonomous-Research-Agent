"""DATABASE_URL handling: driver conversion, TLS, safe logging and engine options.

Pure functions only: nothing here connects to a database.
"""
import ssl

import pytest
from sqlalchemy.engine import make_url

from app.db_url import (
    DEFAULT_DB_PATH, describe_database_url, engine_options, get_driver, is_sqlite, normalise_database_url,
)

@pytest.fixture(autouse=True)
def default_settings(monkeypatch):
    """Each test starts from the defaults, whatever backend/.env sets locally."""
    monkeypatch.setenv("DATABASE_DRIVER", "psycopg")
    monkeypatch.delenv("DATABASE_SSL_ROOT_CERT", raising=False)


SUPABASE_SESSION = "postgresql://postgres.abcdefghijkl:s3cr%40t%2Fpa%3Ass@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"


def test_unset_or_blank_falls_back_to_local_sqlite():
    for raw in (None, "", "   "):
        url = normalise_database_url(raw)
        assert url == f"sqlite:///{DEFAULT_DB_PATH}"
        assert is_sqlite(url)


def test_sqlite_urls_are_kept_as_given():
    assert normalise_database_url("sqlite:///./other.db") == "sqlite:///./other.db"


def test_supabase_session_pooler_uri_uses_psycopg3_and_tls():
    url = make_url(normalise_database_url(SUPABASE_SESSION))
    assert url.drivername == "postgresql+psycopg"
    assert url.host == "aws-0-eu-west-1.pooler.supabase.com"
    assert url.port == 5432
    assert url.username == "postgres.abcdefghijkl"
    assert url.database == "postgres"
    assert url.query["sslmode"] == "require"


def test_password_with_special_characters_survives_conversion():
    url = make_url(normalise_database_url(SUPABASE_SESSION))
    assert url.password == "s3cr@t/pa:ss"


def test_every_postgres_spelling_maps_to_psycopg3():
    for scheme in ("postgres", "postgresql", "postgresql+psycopg2", "postgresql+psycopg", "postgresql+pg8000"):
        url = make_url(normalise_database_url(f"{scheme}://u:p@db.example.com:5432/app"))
        assert url.drivername == "postgresql+psycopg", scheme


def test_explicit_sslmode_is_respected_and_local_postgres_needs_no_tls():
    assert make_url(normalise_database_url("postgresql://u:p@db.example.com/app?sslmode=verify-full")).query["sslmode"] == "verify-full"
    local = make_url(normalise_database_url("postgresql://u:p@localhost:5432/app"))
    assert "sslmode" not in local.query


def test_description_for_logs_never_contains_credentials():
    text = describe_database_url(normalise_database_url(SUPABASE_SESSION))
    assert text == "postgresql+psycopg (host=aws-0-eu-west-1.pooler.supabase.com:5432, database=postgres)"
    for secret in ("s3cr", "pa:ss", "%40", "postgres.abcdefghijkl"):
        assert secret not in text
    assert describe_database_url(normalise_database_url(None)) == "sqlite (local file)"


def test_engine_options_sqlite_only_option_is_not_sent_to_postgres():
    assert engine_options(normalise_database_url(None)) == {"connect_args": {"check_same_thread": False}}
    pg = engine_options(normalise_database_url(SUPABASE_SESSION))
    assert "check_same_thread" not in pg.get("connect_args", {})
    assert pg["pool_pre_ping"] is True
    assert pg["pool_size"] + pg["max_overflow"] <= 10  # stays within Supabase's small pooler limits


def test_transaction_pooler_disables_prepared_statements():
    url = normalise_database_url("postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres")
    assert engine_options(url)["connect_args"] == {"prepare_threshold": None}


def test_unencoded_at_sign_in_password_is_handled():
    """Passwords copied straight into the URI often contain @: the last @ separates the host."""
    raw = "postgresql://postgres.abcdefghijkl:pa@ss@w0rd@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
    url = make_url(normalise_database_url(raw, driver="pg8000"))
    assert url.password == "pa@ss@w0rd"
    assert url.host == "aws-0-ap-northeast-1.pooler.supabase.com"
    assert url.username == "postgres.abcdefghijkl"


def test_already_encoded_password_is_not_double_encoded():
    url = make_url(normalise_database_url(SUPABASE_SESSION, driver="pg8000"))
    assert url.password == "s3cr@t/pa:ss"


def test_driver_setting_selects_pg8000_and_defaults_to_psycopg(monkeypatch):
    monkeypatch.delenv("DATABASE_DRIVER", raising=False)
    assert get_driver() == "psycopg"
    monkeypatch.setenv("DATABASE_DRIVER", "pg8000")
    assert make_url(normalise_database_url(SUPABASE_SESSION)).drivername == "postgresql+pg8000"
    monkeypatch.setenv("DATABASE_DRIVER", "mysqlclient")
    with pytest.raises(ValueError):
        get_driver()


def test_pg8000_uses_verified_tls_and_drops_libpq_only_options():
    url = normalise_database_url(SUPABASE_SESSION + "?sslmode=require", driver="pg8000")
    assert "sslmode" not in make_url(url).query
    ctx = engine_options(url)["connect_args"]["ssl_context"]
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname is True


def test_psycopg_verifies_the_server_when_a_root_certificate_is_configured(monkeypatch):
    monkeypatch.setenv("DATABASE_SSL_ROOT_CERT", "/certs/supabase.crt")
    q = make_url(normalise_database_url(SUPABASE_SESSION, driver="psycopg")).query
    assert q["sslmode"] == "verify-full" and q["sslrootcert"] == "/certs/supabase.crt"