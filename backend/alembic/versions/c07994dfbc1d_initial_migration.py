"""Initial_migration: add papers.overview

Revision ID: c07994dfbc1d
Revises:
Create Date: 2026-10-10 16:38:01.914805

Written when the tables were created by the app at startup (create_all), so
it assumed "papers" already existed. It now only adds the column where the
table exists without it; on an empty database (e.g. a new PostgreSQL) it does
nothing, and the baseline revision that follows creates the full schema.
Databases already at this revision are not affected by this change.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c07994dfbc1d'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _papers_columns() -> set[str] | None:
    if context.is_offline_mode():
        return None  # offline SQL is for an empty database: the baseline creates the column
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("papers"):
        return None
    return {c["name"] for c in inspector.get_columns("papers")}


def upgrade() -> None:
    """Upgrade schema."""
    columns = _papers_columns()
    if columns is not None and "overview" not in columns:
        op.add_column('papers', sa.Column('overview', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    columns = _papers_columns()
    if columns is not None and "overview" in columns:
        op.drop_column('papers', 'overview')
