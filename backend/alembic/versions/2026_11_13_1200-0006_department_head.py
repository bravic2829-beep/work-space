"""department head

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-13 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("departments", sa.Column("head_user_id", sa.Uuid(), nullable=True))
    op.create_index("ix_departments_head_user_id", "departments", ["head_user_id"], unique=False)
    op.create_foreign_key(
        "fk_departments_head_user_id_users",
        "departments",
        "users",
        ["head_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_departments_head_user_id_users", "departments", type_="foreignkey")
    op.drop_index("ix_departments_head_user_id", table_name="departments")
    op.drop_column("departments", "head_user_id")
