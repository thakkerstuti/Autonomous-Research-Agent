"""Think while you wait: reflections

Revision ID: d3a8c5e1f472
Revises: b6d2f8a4c1e9
Create Date: 2026-11-20 12:00:00

- reflections: the questions CogNexa asks while a research run (or a Paper Study
  output) is being written, the user's answers, and the feedback comparing them
  with the result. Exactly one of session_id / paper_id is set; one reflection
  per research run (session_id is unique). Deleting the user, session or paper
  removes its reflections (CASCADE).

Added only where missing. On PostgreSQL, Row Level Security is enabled with no
policies, like every other table, so only the backend can read it.

Downgrade never drops the table: it holds the users' own answers. It only turns
Row Level Security off again.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3a8c5e1f472'
down_revision: Union[str, Sequence[str], None] = 'b6d2f8a4c1e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "reflections"


def _exists() -> bool:
    if context.is_offline_mode():
        return False  # offline SQL is for a database at the previous revision
    return sa.inspect(op.get_bind()).has_table(TABLE)


def upgrade() -> None:
    """Upgrade schema."""
    if not _exists():
        op.create_table(
            TABLE,
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=False),
            sa.Column('session_id', sa.String(), nullable=True),
            sa.Column('paper_id', sa.String(), nullable=True),
            sa.Column('thread_id', sa.String(length=36), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=False),
            sa.Column('pause_reason', sa.String(length=16), nullable=True),
            sa.Column('questions', sa.JSON(), nullable=False),
            sa.Column('feedback', sa.JSON(), nullable=True),
            sa.Column('generating_since', sa.DateTime(), nullable=True),
            sa.Column('exhausted', sa.Boolean(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.CheckConstraint('(session_id IS NULL) <> (paper_id IS NULL)', name='ck_reflections_one_owner'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['session_id'], ['research_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['paper_id'], ['papers.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('session_id'),
        )
        op.create_index('ix_reflections_user_id', TABLE, ['user_id'], unique=False)
        op.create_index('ix_reflections_paper_id', TABLE, ['paper_id'], unique=False)
        op.create_index('ix_reflections_thread_id', TABLE, ['thread_id'], unique=False)
    if op.get_bind().dialect.name == "postgresql":
        op.execute(sa.text(f'ALTER TABLE "{TABLE}" ENABLE ROW LEVEL SECURITY'))


def downgrade() -> None:
    """Downgrade schema: keeps the table (see the module docstring)."""
    if op.get_bind().dialect.name != "postgresql":
        return
    if context.is_offline_mode() or sa.inspect(op.get_bind()).has_table(TABLE):
        op.execute(sa.text(f'ALTER TABLE "{TABLE}" DISABLE ROW LEVEL SECURITY'))
