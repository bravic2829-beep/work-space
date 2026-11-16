"""activity log, handovers, and the changes_requested notification

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-14 11:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOTE = "ck_notifications_notification_type"
_NOTE_OLD = "'task_assigned', 'review_requested'"
_NOTE_NEW = _NOTE_OLD + ", 'changes_requested'"


def _set_types(values: str) -> None:
    op.execute(f'ALTER TABLE notifications DROP CONSTRAINT "{_NOTE}"')
    op.execute(f'ALTER TABLE notifications ADD CONSTRAINT "{_NOTE}" CHECK (type IN ({values}))')


def _user_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], ["users.id"], name=op.f(f"fk_{table}_{column}_users"), ondelete="RESTRICT"
    )


def _record_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["record_id"],
        ["records.id"],
        name=op.f(f"fk_{table}_record_id_records"),
        ondelete="CASCADE",
    )


def upgrade() -> None:
    """Upgrade schema."""
    _set_types(_NOTE_NEW)

    op.create_table(
        "activity_log",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column(
            "action",
            sa.Enum(
                "created",
                "updated",
                "submitted",
                "approved",
                "sent_back",
                "timer_started",
                "timer_stopped",
                "handed_over",
                name="activity_action",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "changes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        _record_fk("activity_log"),
        _user_fk("activity_log", "actor_id"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_log")),
    )
    op.create_index(
        "ix_activity_log_record_created", "activity_log", ["record_id", "created_at"], unique=False
    )

    op.create_table(
        "handovers",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("from_user_id", sa.Uuid(), nullable=True),
        sa.Column("to_user_id", sa.Uuid(), nullable=False),
        sa.Column("by_user_id", sa.Uuid(), nullable=False),
        sa.Column("result", sa.Text(), nullable=False),
        sa.Column("documents", sa.String(length=2000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        _record_fk("handovers"),
        _user_fk("handovers", "from_user_id"),
        _user_fk("handovers", "to_user_id"),
        _user_fk("handovers", "by_user_id"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_handovers")),
    )
    op.create_index("ix_handovers_record_id", "handovers", ["record_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_handovers_record_id", table_name="handovers")
    op.drop_table("handovers")
    op.drop_index("ix_activity_log_record_created", table_name="activity_log")
    op.drop_table("activity_log")
    op.execute("DELETE FROM notifications WHERE type = 'changes_requested'")
    _set_types(_NOTE_OLD)
