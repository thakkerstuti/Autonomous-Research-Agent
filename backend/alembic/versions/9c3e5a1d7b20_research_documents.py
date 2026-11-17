"""Research threads, working-flow progress and full research papers

Revision ID: 9c3e5a1d7b20
Revises: 4b1d2f9c8a73
Create Date: 2026-11-17 12:00:00

- research_sessions: two nullable columns, thread_id (which conversation a
  question belongs to; NULL means the session is its own thread, so every
  existing session keeps working unchanged) and progress (the user-facing
  working flow). Existing rows are untouched.
- research_documents: the full research paper written from one session.
- research_document_versions: every saved state of a paper. Version 1 is the
  generated original; each save adds a version, so nothing is overwritten.

Everything is added only where it is missing. On PostgreSQL, Row Level Security
is enabled on the new tables (no policies), like every other table: only the
backend, which connects as the table owner, can read them.

Downgrade never drops a table or column: they may hold the only copy of a
user's edited paper. It only turns Row Level Security off again.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9c3e5a1d7b20'
down_revision: Union[str, Sequence[str], None] = '4b1d2f9c8a73'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TABLES = ("research_documents", "research_document_versions")


def _inspector():
    return None if context.is_offline_mode() else sa.inspect(op.get_bind())


def _columns(insp, table: str) -> set[str]:
    if insp is None or not insp.has_table(table):
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _tables(insp) -> set[str]:
    return set() if insp is None else set(insp.get_table_names())


def upgrade() -> None:
    """Upgrade schema."""
    insp = _inspector()
    cols = _columns(insp, "research_sessions")
    if "thread_id" not in cols:
        op.add_column('research_sessions', sa.Column('thread_id', sa.String(length=36), nullable=True))
        op.create_index('ix_research_sessions_thread_id', 'research_sessions', ['thread_id'], unique=False)
    if "progress" not in cols:
        op.add_column('research_sessions', sa.Column('progress', sa.JSON(), nullable=True))

    existing = _tables(insp)
    if "research_documents" not in existing:
        op.create_table(
            'research_documents',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('session_id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=False),
            sa.Column('title', sa.String(length=500), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=False),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('current_version', sa.Integer(), nullable=False),
            sa.Column('edited', sa.Boolean(), nullable=False),
            sa.Column('pdf_path', sa.String(length=512), nullable=True),
            sa.Column('pdf_version', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['session_id'], ['research_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_research_documents_session_id', 'research_documents', ['session_id'], unique=True)
        op.create_index('ix_research_documents_user_id', 'research_documents', ['user_id'], unique=False)
    if "research_document_versions" not in existing:
        op.create_table(
            'research_document_versions',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('document_id', sa.String(), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False),
            sa.Column('source', sa.String(length=16), nullable=False),
            sa.Column('content', sa.JSON(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['document_id'], ['research_documents.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('document_id', 'version', name='uix_research_document_version'),
        )
        op.create_index('ix_research_document_versions_document_id', 'research_document_versions', ['document_id'], unique=False)

    if op.get_bind().dialect.name == "postgresql":
        for table in NEW_TABLES:
            op.execute(sa.text(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY'))


def downgrade() -> None:
    """Downgrade schema: keeps every table and column (see the module docstring)."""
    if op.get_bind().dialect.name == "postgresql":
        insp = _inspector()
        existing = set(NEW_TABLES) if insp is None else _tables(insp)
        for table in NEW_TABLES:
            if table in existing:
                op.execute(sa.text(f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY'))
