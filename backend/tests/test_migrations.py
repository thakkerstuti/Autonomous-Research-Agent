"""Alembic migrations: the schema they build matches app/models.py exactly.

SQLite tests use throwaway files and never touch backend/cognexa.db.

The PostgreSQL test runs only when COGNEXA_TEST_POSTGRES_URL is set (and the
psycopg driver loads). It works inside a temporary schema that it creates and
drops, so it never touches existing tables; even so, point it at a database
meant for testing.
"""
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from app.db_url import engine_options, normalise_database_url
from app.models import Base

BACKEND = Path(__file__).resolve().parent.parent
HEAD = "e7de0666b0a1"
APP_TABLES = {
    "users", "oauth_accounts", "refresh_tokens", "auth_tokens",
    "papers", "paper_pages", "page_summaries", "study_artifacts", "research_sessions",
}


def alembic_config(url: str | None = None, connection=None) -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.attributes["configure_logging"] = False
    if url:
        cfg.attributes["database_url"] = url
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def schema_differences(connection) -> list:
    """What autogenerate would change to make the database match the models (empty = identical)."""
    ctx = MigrationContext.configure(connection, opts={"compare_type": True})
    return compare_metadata(ctx, Base.metadata)


def sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def test_migrations_build_the_full_schema_on_an_empty_database(tmp_path):
    url = sqlite_url(tmp_path / "empty.db")
    command.upgrade(alembic_config(url), "head")

    engine = create_engine(url)
    with engine.connect() as conn:
        tables = set(inspect(conn).get_table_names())
        assert APP_TABLES <= tables
        assert conn.execute(text("select version_num from alembic_version")).scalar() == HEAD
        assert schema_differences(conn) == []
    engine.dispose()


def test_existing_database_keeps_its_data_and_only_moves_to_the_new_revision(tmp_path):
    """Like the local cognexa.db: tables made by create_all, stamped at the old revision."""
    url = sqlite_url(tmp_path / "existing.db")
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("insert into users (id, email, email_verified) values ('u1', 'ada@example.com', 1)"))
        conn.execute(text("insert into papers (id, user_id, title, overview) values ('p1', 'u1', 'Paper', 'An overview')"))
    command.stamp(alembic_config(url), "c07994dfbc1d")

    command.upgrade(alembic_config(url), "head")

    with engine.connect() as conn:
        assert conn.execute(text("select email from users")).scalars().all() == ["ada@example.com"]
        assert conn.execute(text("select overview from papers")).scalar() == "An overview"
        assert conn.execute(text("select version_num from alembic_version")).scalar() == HEAD
        assert schema_differences(conn) == []
    engine.dispose()


def test_app_started_before_migrating_then_migrated(tmp_path):
    """The app creates tables at startup (create_all, unchanged). If that happens before
    `alembic upgrade head`, the migration keeps them and data, and only records the revision."""
    url = sqlite_url(tmp_path / "started-first.db")
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("insert into users (id, email, email_verified) values ('u1', 'grace@example.com', 1)"))

    command.upgrade(alembic_config(url), "head")

    with engine.connect() as conn:
        assert conn.execute(text("select email from users")).scalars().all() == ["grace@example.com"]
        assert conn.execute(text("select version_num from alembic_version")).scalar() == HEAD
        assert schema_differences(conn) == []
    engine.dispose()


def test_downgrade_never_drops_tables(tmp_path):
    url = sqlite_url(tmp_path / "down.db")
    command.upgrade(alembic_config(url), "head")
    command.downgrade(alembic_config(url), "c07994dfbc1d")
    engine = create_engine(url)
    with engine.connect() as conn:
        assert APP_TABLES <= set(inspect(conn).get_table_names())
    engine.dispose()


def test_baseline_defines_every_model_table():
    source = (BACKEND / "alembic" / "versions" / f"{HEAD}_baseline_schema.py").read_text(encoding="utf-8")
    created = set(re.findall(r"op\.create_table\('([a-z_]+)'", source))
    assert created == set(Base.metadata.tables) == APP_TABLES


def test_postgresql_sql_creates_every_table_and_enables_row_level_security(tmp_path):
    """What `alembic upgrade head --sql` would run on an empty PostgreSQL: rendered offline, no connection."""
    # The app's own database for this process: a temp SQLite file, never backend/.env's DATABASE_URL
    env = {**os.environ, "DATABASE_URL": sqlite_url(tmp_path / "offline.db"), "DATABASE_DRIVER": "psycopg"}
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-x", "url=postgresql://someuser:TopSecretPw42@db.invalid:5432/app", "upgrade", "head", "--sql"],
        cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    sql = result.stdout
    for table in APP_TABLES:
        assert re.search(rf"CREATE TABLE {table} \(", sql), table
    for table in APP_TABLES | {"alembic_version"}:
        assert f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY' in sql, table
    assert "CREATE UNIQUE INDEX ix_users_email ON users (email)" in sql
    assert "FOREIGN KEY(paper_id) REFERENCES papers (id) ON DELETE CASCADE" in sql
    assert "TopSecretPw42" not in sql and "someuser" not in sql and "db.invalid" not in sql  # no credentials in the output
    assert f"'{HEAD}'" in sql




# ── PostgreSQL (opt-in) ──────────────────────────────────────────────────────

PG_URL = os.getenv("COGNEXA_TEST_POSTGRES_URL", "").strip()


def _psycopg_loads() -> bool:
    try:
        import psycopg  # noqa: F401
        return True
    except Exception:
        return False


requires_postgres = pytest.mark.skipif(
    not PG_URL or not _psycopg_loads(),
    reason="set COGNEXA_TEST_POSTGRES_URL (and have a loadable psycopg driver) to run PostgreSQL tests",
)


@requires_postgres
def test_postgresql_connects_migrates_and_locks_down_tables():
    url = normalise_database_url(PG_URL)
    schema = f"cognexa_test_{uuid.uuid4().hex[:10]}"
    engine = create_engine(url, **engine_options(url))
    try:
        with engine.connect() as conn:
            assert conn.execute(text("select 1")).scalar() == 1  # connectivity
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            conn.execute(text(f'SET search_path TO "{schema}"'))
            conn.commit()

            command.upgrade(alembic_config(url, connection=conn), "head")
            conn.commit()

            assert APP_TABLES <= set(inspect(conn).get_table_names(schema=schema))
            assert schema_differences(conn) == []
            rls = dict(conn.execute(text(
                "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace "
                "where n.nspname = :schema and c.relkind = 'r'"
            ), {"schema": schema}).all())
            assert all(rls[t] for t in APP_TABLES | {"alembic_version"}), rls
    finally:
        with engine.connect() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            conn.commit()
        engine.dispose()
