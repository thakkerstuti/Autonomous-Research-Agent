"""Alembic environment for Cognexa.

The database is the app's own: DATABASE_URL (normalised by app.db_url for
psycopg 3 and TLS), or the local SQLite fallback when it isn't set. A URL can
also be given explicitly: `alembic -x url=... <command>` or, from code,
config.attributes["database_url"].

Credentials are never written to alembic.ini or printed.
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.db_url import engine_options, get_database_url, is_sqlite, normalise_database_url  # noqa: E402
from app.models import Base  # noqa: E402

config = context.config

# Logging from alembic.ini, without silencing loggers the app already set up
if config.config_file_name is not None and config.attributes.get("configure_logging", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _url() -> str:
    explicit = config.attributes.get("database_url") or context.get_x_argument(as_dictionary=True).get("url")
    return normalise_database_url(explicit) if explicit else get_database_url()


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (alembic upgrade head --sql)."""
    url = _url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=is_sqlite(url),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _url()
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection, url)
        return
    connect_args = engine_options(url).get("connect_args", {})  # incl. verified TLS for pg8000
    engine = create_engine(url, poolclass=pool.NullPool, connect_args=connect_args)
    with engine.connect() as conn:
        _run(conn, url)
    engine.dispose()


def _run(connection, url: str) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=is_sqlite(url),  # SQLite can't ALTER most things in place
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
