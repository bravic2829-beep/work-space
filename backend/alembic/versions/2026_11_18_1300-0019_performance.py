"""performance: criteria, their history and manual scores

Three new tables of their own; no table of another module is changed.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-18 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

METRICS = (
    "completion_rate",
    "on_time_rate",
    "overdue_rate",
    "rework_rate",
    "blocked_tasks",
    "update_compliance",
)


def _uuid_pk() -> sa.Column[sa.Uuid]:
    return sa.Column("id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False)


def _stamp(name: str) -> sa.Column[sa.DateTime]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def _fk(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    parent = target.split(".")[0]
    return sa.ForeignKeyConstraint(
        [column], [target], name=op.f(f"fk_{table}_{column}_{parent}"), ondelete=ondelete
    )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "perf_criteria",
        _uuid_pk(),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("weight", sa.Integer(), nullable=False),
        sa.Column(
            "metric",
            sa.Enum(*METRICS, name="perf_metric", native_enum=False, create_constraint=True, length=32),
            nullable=True,
        ),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.CheckConstraint(
            "weight >= 0 AND weight <= 100", name=op.f("ck_perf_criteria_weight_range")
        ),
        _fk("perf_criteria", "organization_id", "organizations.id", "RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_perf_criteria")),
    )
    op.create_index(
        "uq_perf_criteria_org_name",
        "perf_criteria",
        ["organization_id", sa.text("lower(name)")],
        unique=True,
    )

    op.create_table(
        "perf_criterion_changes",
        _uuid_pk(),
        sa.Column("criterion_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column(
            "changes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        _stamp("created_at"),
        _fk("perf_criterion_changes", "criterion_id", "perf_criteria.id", "CASCADE"),
        _fk("perf_criterion_changes", "actor_id", "users.id", "RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_perf_criterion_changes")),
    )
    op.create_index(
        "ix_perf_criterion_changes_criterion_id", "perf_criterion_changes", ["criterion_id"]
    )

    op.create_table(
        "perf_manual_scores",
        _uuid_pk(),
        sa.Column("criterion_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("scored_by", sa.Uuid(), nullable=False),
        _stamp("created_at"),
        _stamp("updated_at"),
        sa.CheckConstraint(
            "score >= 0 AND score <= 100", name=op.f("ck_perf_manual_scores_score_range")
        ),
        _fk("perf_manual_scores", "criterion_id", "perf_criteria.id", "CASCADE"),
        _fk("perf_manual_scores", "user_id", "users.id", "CASCADE"),
        _fk("perf_manual_scores", "scored_by", "users.id", "RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_perf_manual_scores")),
    )
    op.create_index(
        "uq_perf_manual_scores_criterion_user_period",
        "perf_manual_scores",
        ["criterion_id", "user_id", "period"],
        unique=True,
    )
    op.create_index("ix_perf_manual_scores_user_id", "perf_manual_scores", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("perf_manual_scores")
    op.drop_table("perf_criterion_changes")
    op.drop_table("perf_criteria")
