"""papers.storage_path: where the original PDF is kept in Supabase Storage

Revision ID: 4b1d2f9c8a73
Revises: e7de0666b0a1
Create Date: 2026-11-17 01:10:00

Adds one nullable column. Existing rows are untouched (NULL means the PDF is a
local file, or is no longer stored), so the change is backward compatible and
instant on PostgreSQL. It is added only where it is missing.

Downgrade leaves the column in place: it may hold the only record of where a
paper's original PDF is stored.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4b1d2f9c8a73'
down_revision: Union[str, Sequence[str], None] = 'e7de0666b0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column() -> bool:
    if context.is_offline_mode():
        return False  # offline SQL is for a database at the previous revision
    inspector = sa.inspect(op.get_bind())
    return inspector.has_table("papers") and "storage_path" in {c["name"] for c in inspector.get_columns("papers")}


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_column():
        op.add_column('papers', sa.Column('storage_path', sa.String(length=512), nullable=True))


def downgrade() -> None:
    """Downgrade schema: the column is kept (see the module docstring)."""
