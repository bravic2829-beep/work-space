"""task timer: two new field semantics

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-14 09:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "ck_fields_field_semantic"
_OLD = "'assignee', 'follower', 'status', 'due_date', 'parent', 'subtasks'"
_NEW = _OLD + ", 'timer_start', 'timer_stop'"


def _replace(values: str) -> None:
    op.execute(f'ALTER TABLE fields DROP CONSTRAINT "{_CHECK}"')
    op.execute(f'ALTER TABLE fields ADD CONSTRAINT "{_CHECK}" CHECK (semantic IN ({values}))')


def upgrade() -> None:
    """Upgrade schema."""
    _replace(_NEW)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM fields WHERE semantic IN ('timer_start', 'timer_stop')")
    _replace(_OLD)
