"""Follow-up chat messages for research sessions

Revision ID: b6d2f8a4c1e9
Revises: 9c3e5a1d7b20
Create Date: 2026-11-19 10:00:00

- chat_messages: each research session's own follow-up chat. One row per message
  (user or assistant), with the numbered sources an answer cites and whether it
  searched the web. Deleting a session or user removes its messages (CASCADE).

Added only where missing. On PostgreSQL, Row Level Security is enabled with no
policies, like every other table, so only the backend can read it.

Downgrade never drops the table: it holds users' conversations. It only turns
Row Level Security off again.
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b6d2f8a4c1e9'
down_revision: Union[str, Sequence[str], None] = '9c3e5a1d7b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "chat_messages"


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
            sa.Column('session_id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=False),
            sa.Column('role', sa.String(length=16), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('sources', sa.JSON(), nullable=True),
            sa.Column('used_web_search', sa.Boolean(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['session_id'], ['research_sessions.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_chat_messages_session_created', TABLE, ['session_id', 'created_at'], unique=False)
        op.create_index('ix_chat_messages_user_id', TABLE, ['user_id'], unique=False)
    if op.get_bind().dialect.name == "postgresql":
        op.execute(sa.text(f'ALTER TABLE "{TABLE}" ENABLE ROW LEVEL SECURITY'))


def downgrade() -> None:
    """Downgrade schema: keeps the table (see the module docstring)."""
    if op.get_bind().dialect.name != "postgresql":
        return
    if context.is_offline_mode() or sa.inspect(op.get_bind()).has_table(TABLE):
        op.execute(sa.text(f'ALTER TABLE "{TABLE}" DISABLE ROW LEVEL SECURITY'))
