"""sheets: per-person sheets with their own members

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-14 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SEMANTIC = "ck_fields_field_semantic"
_SEMANTIC_OLD = (
    "'assignee', 'follower', 'status', 'due_date', 'parent', 'subtasks', "
    "'timer_start', 'timer_stop'"
)
_SEMANTIC_NEW = _SEMANTIC_OLD + ", 'feedback'"
_REASON = "ck_record_viewers_viewer_reason"
_REASON_OLD = "'creator', 'field'"
_REASON_NEW = "'creator', 'field', 'sheet'"


def _widen(table: str, constraint: str, column: str, values: str) -> None:
    op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{constraint}"')
    op.execute(f'ALTER TABLE {table} ADD CONSTRAINT "{constraint}" CHECK ({column} IN ({values}))')


def upgrade() -> None:
    """Upgrade schema."""
    _widen("fields", _SEMANTIC, "semantic", _SEMANTIC_NEW)
    _widen("record_viewers", _REASON, "reason", _REASON_NEW)

    op.create_table(
        "sheets",
        sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("table_id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_sheets_organization_id_organizations"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["table_id"], ["tables.id"], name=op.f("fk_sheets_table_id_tables"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_sheets_owner_id_users"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_sheets_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sheets")),
    )
    op.create_index("ix_sheets_table_id", "sheets", ["table_id"], unique=False)
    op.create_index(
        "uq_sheets_table_owner",
        "sheets",
        ["table_id", "owner_id"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )

    op.create_table(
        "sheet_members",
        sa.Column("sheet_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "viewer",
                "commenter",
                "editor",
                "manager",
                name="sheet_role",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["sheet_id"],
            ["sheets.id"],
            name=op.f("fk_sheet_members_sheet_id_sheets"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_sheet_members_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("sheet_id", "user_id", name=op.f("pk_sheet_members")),
    )
    op.create_index("ix_sheet_members_user_id", "sheet_members", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_sheet_members_user_id", table_name="sheet_members")
    op.drop_table("sheet_members")
    op.drop_index("uq_sheets_table_owner", table_name="sheets")
    op.drop_index("ix_sheets_table_id", table_name="sheets")
    op.drop_table("sheets")
    op.execute("DELETE FROM record_viewers WHERE reason = 'sheet'")
    _widen("record_viewers", _REASON, "reason", _REASON_OLD)
    op.execute("DELETE FROM fields WHERE semantic = 'feedback'")
    _widen("fields", _SEMANTIC, "semantic", _SEMANTIC_OLD)
