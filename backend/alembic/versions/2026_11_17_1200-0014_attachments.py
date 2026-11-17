"""attachments: files kept in a column of type attachment

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-17 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TYPE = "ck_fields_field_type"
_TYPES_OLD = (
    "'text', 'long_text', 'number', 'date', 'checkbox', 'single_select', 'multi_select', "
    "'status', 'user', 'url', 'link_record', 'created_by', 'created_time', 'auto_number', "
    "'timer'"
)
_TYPES_NEW = _TYPES_OLD + ", 'attachment'"
_ACTION = "ck_activity_log_activity_action"
_ACTIONS_OLD = (
    "'created', 'updated', 'submitted', 'approved', 'sent_back', 'timer_started', "
    "'timer_stopped', 'handed_over'"
)
_ACTIONS_NEW = _ACTIONS_OLD + ", 'attachment_added', 'attachment_removed'"


def _widen(table: str, constraint: str, column: str, values: str) -> None:
    op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{constraint}"')
    op.execute(f'ALTER TABLE {table} ADD CONSTRAINT "{constraint}" CHECK ({column} IN ({values}))')


def upgrade() -> None:
    """Upgrade schema."""
    _widen("fields", _TYPE, "type", _TYPES_NEW)
    _widen("activity_log", _ACTION, "action", _ACTIONS_NEW)

    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("field_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(length=64), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["record_id"],
            ["records.id"],
            name=op.f("fk_attachments_record_id_records"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["field_id"],
            ["fields.id"],
            name=op.f("fk_attachments_field_id_fields"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            ["users.id"],
            name=op.f("fk_attachments_uploaded_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attachments")),
        sa.UniqueConstraint("storage_key", name=op.f("uq_attachments_storage_key")),
    )
    op.create_index(
        "ix_attachments_record_field", "attachments", ["record_id", "field_id"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_attachments_record_field", table_name="attachments")
    op.drop_table("attachments")
    op.execute(
        "DELETE FROM activity_log WHERE action IN ('attachment_added', 'attachment_removed')"
    )
    _widen("activity_log", _ACTION, "action", _ACTIONS_OLD)
    op.execute("DELETE FROM fields WHERE type = 'attachment'")
    _widen("fields", _TYPE, "type", _TYPES_OLD)
