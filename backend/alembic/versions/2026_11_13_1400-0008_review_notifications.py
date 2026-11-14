"""review notifications and comments

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-13 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "ck_notifications_notification_type"


def upgrade() -> None:
    """Upgrade schema."""
    # A new notification type (review_requested): widen the CHECK on notifications.type.
    op.execute(f'ALTER TABLE notifications DROP CONSTRAINT "{_CHECK}"')
    op.execute(
        f'ALTER TABLE notifications ADD CONSTRAINT "{_CHECK}" '
        "CHECK (type IN ('task_assigned', 'review_requested'))"
    )

    op.create_table(
        "comments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(btrim(body)) BETWEEN 1 AND 5000", name=op.f("ck_comments_body_length")
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            ["users.id"],
            name=op.f("fk_comments_author_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["record_id"],
            ["records.id"],
            name=op.f("fk_comments_record_id_records"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comments")),
    )
    op.create_index(
        "ix_comments_record_created", "comments", ["record_id", "created_at", "id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_comments_record_created", table_name="comments")
    op.drop_table("comments")
    op.execute("DELETE FROM notifications WHERE type = 'review_requested'")
    op.execute(f'ALTER TABLE notifications DROP CONSTRAINT "{_CHECK}"')
    op.execute(
        f"ALTER TABLE notifications ADD CONSTRAINT \"{_CHECK}\" CHECK (type IN ('task_assigned'))"
    )
