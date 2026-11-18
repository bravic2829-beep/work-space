"""okr: cycles, objectives, key results and check-ins

Four new tables of their own; no table of another module is changed.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-18 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018"
down_revision: str | Sequence[str] | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True, length=32)


def _uuid_pk() -> sa.Column[sa.Uuid]:
    return sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False)


def _created_at() -> sa.Column[sa.DateTime]:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def _updated_at() -> sa.Column[sa.DateTime]:
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def _fk(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    parent = target.split(".")[0]
    return sa.ForeignKeyConstraint(
        [column],
        [target],
        name=op.f(f"fk_{table}_{column}_{parent}"),
        ondelete=ondelete,
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "okr_cycles",
        _uuid_pk(),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column(
            "status",
            _enum("okr_cycle_status", "open", "closed"),
            server_default="open",
            nullable=False,
        ),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        _created_at(),
        sa.CheckConstraint("ends_on >= starts_on", name=op.f("ck_okr_cycles_ends_after_start")),
        _fk("okr_cycles", "organization_id", "organizations.id", "RESTRICT"),
        _fk("okr_cycles", "created_by", "users.id", "RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_okr_cycles")),
    )
    op.create_index(
        "uq_okr_cycles_org_name",
        "okr_cycles",
        ["organization_id", sa.text("lower(name)")],
        unique=True,
    )

    op.create_table(
        "okr_objectives",
        _uuid_pk(),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("cycle_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("level", _enum("okr_level", "company", "department", "personal"), nullable=False),
        sa.Column("department_id", sa.Uuid(), nullable=True),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("is_private", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("score", sa.Numeric(3, 2), nullable=True),
        sa.Column("merits", sa.Text(), nullable=True),
        sa.Column("to_improve", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 1)",
            name=op.f("ck_okr_objectives_score_range"),
        ),
        sa.CheckConstraint(
            "(level = 'department') = (department_id IS NOT NULL)",
            name=op.f("ck_okr_objectives_department_for_level"),
        ),
        sa.CheckConstraint("parent_id <> id", name=op.f("ck_okr_objectives_no_self_parent")),
        _fk("okr_objectives", "organization_id", "organizations.id", "RESTRICT"),
        _fk("okr_objectives", "cycle_id", "okr_cycles.id", "RESTRICT"),
        _fk("okr_objectives", "owner_id", "users.id", "RESTRICT"),
        _fk("okr_objectives", "department_id", "departments.id", "RESTRICT"),
        _fk("okr_objectives", "parent_id", "okr_objectives.id", "SET NULL"),
        _fk("okr_objectives", "created_by", "users.id", "RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_okr_objectives")),
    )
    op.create_index("ix_okr_objectives_cycle_id", "okr_objectives", ["cycle_id"], unique=False)
    op.create_index("ix_okr_objectives_owner_id", "okr_objectives", ["owner_id"], unique=False)
    op.create_index("ix_okr_objectives_parent_id", "okr_objectives", ["parent_id"], unique=False)

    op.create_table(
        "okr_key_results",
        _uuid_pk(),
        sa.Column("objective_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("unit", sa.String(length=20), server_default="", nullable=False),
        sa.Column("start_value", sa.Numeric(18, 4), server_default="0", nullable=False),
        sa.Column("target_value", sa.Numeric(18, 4), nullable=False),
        sa.Column("current_value", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "status",
            _enum("okr_kr_status", "on_track", "at_risk", "off_track"),
            server_default="on_track",
            nullable=False,
        ),
        sa.Column("score", sa.Numeric(3, 2), nullable=True),
        sa.Column("merits", sa.Text(), nullable=True),
        sa.Column("to_improve", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _created_at(),
        _updated_at(),
        sa.CheckConstraint(
            "target_value <> start_value", name=op.f("ck_okr_key_results_target_differs_from_start")
        ),
        sa.CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 1)",
            name=op.f("ck_okr_key_results_score_range"),
        ),
        _fk("okr_key_results", "objective_id", "okr_objectives.id", "CASCADE"),
        _fk("okr_key_results", "owner_id", "users.id", "RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_okr_key_results")),
    )
    op.create_index(
        "ix_okr_key_results_objective_id", "okr_key_results", ["objective_id"], unique=False
    )
    op.create_index("ix_okr_key_results_owner_id", "okr_key_results", ["owner_id"], unique=False)

    op.create_table(
        "okr_check_ins",
        _uuid_pk(),
        sa.Column("key_result_id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("value", sa.Numeric(18, 4), nullable=False),
        sa.Column(
            "status",
            _enum("okr_check_in_status", "on_track", "at_risk", "off_track"),
            nullable=False,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        _created_at(),
        _fk("okr_check_ins", "key_result_id", "okr_key_results.id", "CASCADE"),
        _fk("okr_check_ins", "author_id", "users.id", "RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_okr_check_ins")),
    )
    op.create_index(
        "ix_okr_check_ins_key_result_created",
        "okr_check_ins",
        ["key_result_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_okr_check_ins_key_result_created", table_name="okr_check_ins")
    op.drop_table("okr_check_ins")
    op.drop_index("ix_okr_key_results_owner_id", table_name="okr_key_results")
    op.drop_index("ix_okr_key_results_objective_id", table_name="okr_key_results")
    op.drop_table("okr_key_results")
    op.drop_index("ix_okr_objectives_parent_id", table_name="okr_objectives")
    op.drop_index("ix_okr_objectives_owner_id", table_name="okr_objectives")
    op.drop_index("ix_okr_objectives_cycle_id", table_name="okr_objectives")
    op.drop_table("okr_objectives")
    op.drop_index("uq_okr_cycles_org_name", table_name="okr_cycles")
    op.drop_table("okr_cycles")
