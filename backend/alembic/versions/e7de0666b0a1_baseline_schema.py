"""Baseline schema: every table the app uses, as defined in app/models.py

Revision ID: e7de0666b0a1
Revises: c07994dfbc1d
Create Date: 2026-11-16 23:11:19.925206

Before this revision the tables were created by the app at startup
(Base.metadata.create_all), so no migration created them. This revision
creates each table, with its constraints and indexes, only if it is missing:

- on an empty database (e.g. a new Supabase PostgreSQL) it builds the full
  schema;
- on an existing database (e.g. the local SQLite fallback) it changes nothing
  and only records the revision.

On PostgreSQL it also enables Row Level Security on every table, with no
policies. Supabase exposes the public schema through its Data API; with RLS
on and no policies that API can read or write nothing. The backend connects
as the table owner, which RLS does not restrict, so the app is unaffected.

Downgrade never drops tables (they may hold data that existed before this
revision): on PostgreSQL it only turns Row Level Security off again.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7de0666b0a1'
down_revision: Union[str, Sequence[str], None] = 'c07994dfbc1d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Every table the app owns, plus Alembic's own bookkeeping table (also in the public schema)
APP_TABLES = (
    "users", "oauth_accounts", "refresh_tokens", "auth_tokens",
    "papers", "paper_pages", "page_summaries", "study_artifacts", "research_sessions",
)
RLS_TABLES = APP_TABLES + ("alembic_version",)


def _create_tables(existing: set[str]) -> None:
    """Parents before children, so foreign keys always resolve."""
    def missing(name: str) -> bool:
        return name not in existing

    # ── Authentication
    if missing("users"):
        op.create_table('users',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('email', sa.String(length=320), nullable=False),
            sa.Column('email_verified', sa.Boolean(), nullable=False),
            sa.Column('password_hash', sa.String(), nullable=True),
            sa.Column('name', sa.String(length=120), nullable=True),
            sa.Column('avatar_url', sa.String(length=1024), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('last_login_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_users_email', 'users', ['email'], unique=True)

    if missing("oauth_accounts"):
        op.create_table('oauth_accounts',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=False),
            sa.Column('provider', sa.String(length=32), nullable=False),
            sa.Column('provider_subject', sa.String(length=255), nullable=False),
            sa.Column('email', sa.String(length=320), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('provider', 'provider_subject', name='uix_oauth_provider_subject'),
        )
        op.create_index('ix_oauth_accounts_user_id', 'oauth_accounts', ['user_id'], unique=False)

    if missing("refresh_tokens"):
        op.create_table('refresh_tokens',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=False),
            sa.Column('family_id', sa.String(), nullable=False),
            sa.Column('token_hash', sa.String(length=64), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('revoked_at', sa.DateTime(), nullable=True),
            sa.Column('revoked_reason', sa.String(length=32), nullable=True),
            sa.Column('user_agent', sa.String(length=512), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_refresh_tokens_family_id', 'refresh_tokens', ['family_id'], unique=False)
        op.create_index('ix_refresh_tokens_token_hash', 'refresh_tokens', ['token_hash'], unique=True)
        op.create_index('ix_refresh_tokens_user_id', 'refresh_tokens', ['user_id'], unique=False)

    if missing("auth_tokens"):
        op.create_table('auth_tokens',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=False),
            sa.Column('purpose', sa.String(length=32), nullable=False),
            sa.Column('token_hash', sa.String(length=64), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('used_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_auth_tokens_token_hash', 'auth_tokens', ['token_hash'], unique=True)
        op.create_index('ix_auth_tokens_user_id', 'auth_tokens', ['user_id'], unique=False)

    # ── Papers (user_id and paper_id are plain indexed columns, as in the models: no foreign keys)
    if missing("papers"):
        op.create_table('papers',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=True),
            sa.Column('title', sa.String(), nullable=True),
            sa.Column('page_count', sa.Integer(), nullable=True),
            sa.Column('file_size', sa.Integer(), nullable=True),
            sa.Column('level', sa.String(), nullable=True),
            sa.Column('status', sa.String(), nullable=True),
            sa.Column('overview', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )

    if missing("paper_pages"):
        op.create_table('paper_pages',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('paper_id', sa.String(), nullable=True),
            sa.Column('page_number', sa.Integer(), nullable=True),
            sa.Column('text', sa.Text(), nullable=True),
            sa.Column('status', sa.String(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('paper_id', 'page_number', name='uix_paper_page'),
        )
        op.create_index('ix_paper_pages_paper_id', 'paper_pages', ['paper_id'], unique=False)

    if missing("page_summaries"):
        op.create_table('page_summaries',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('paper_id', sa.String(), nullable=True),
            sa.Column('page_number', sa.Integer(), nullable=True),
            sa.Column('level', sa.String(), nullable=True),
            sa.Column('summary', sa.Text(), nullable=True),
            sa.Column('key_points', sa.JSON(), nullable=True),
            sa.Column('terms', sa.JSON(), nullable=True),
            sa.Column('figures', sa.JSON(), nullable=True),
            sa.Column('status', sa.String(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('model', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('paper_id', 'page_number', 'level', name='uix_paper_page_level'),
        )
        op.create_index('ix_page_summaries_paper_id', 'page_summaries', ['paper_id'], unique=False)

    # ── Study kit: summary, questions, insights, flashcards, flashcard progress, assistant history
    if missing("study_artifacts"):
        op.create_table('study_artifacts',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('paper_id', sa.String(), nullable=False),
            sa.Column('kind', sa.String(length=64), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=False),
            sa.Column('content', sa.JSON(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['paper_id'], ['papers.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('paper_id', 'kind', name='uix_study_paper_kind'),
        )
        op.create_index('ix_study_artifacts_paper_id', 'study_artifacts', ['paper_id'], unique=False)

    # ── Research: hypotheses, evidence, critique, report and stats are columns of the session
    if missing("research_sessions"):
        op.create_table('research_sessions',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=True),
            sa.Column('title', sa.String(), nullable=True),
            sa.Column('question', sa.Text(), nullable=True),
            sa.Column('output_format', sa.String(), nullable=True),
            sa.Column('status', sa.String(), nullable=True),
            sa.Column('hypotheses', sa.JSON(), nullable=True),
            sa.Column('evidence_log', sa.JSON(), nullable=True),
            sa.Column('critique', sa.JSON(), nullable=True),
            sa.Column('report', sa.Text(), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('stats', sa.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )


def _existing_tables() -> set[str]:
    # Offline mode (alembic upgrade head --sql) prints SQL for an empty database
    if context.is_offline_mode():
        return set()
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    _create_tables(_existing_tables())
    if bind.dialect.name == "postgresql":
        for table in RLS_TABLES:
            op.execute(sa.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))


def downgrade() -> None:
    """Downgrade schema: never drops tables; on PostgreSQL turns Row Level Security off."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        existing = set(RLS_TABLES) if context.is_offline_mode() else _existing_tables()
        for table in RLS_TABLES:
            if table in existing:
                op.execute(sa.text(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY'))
