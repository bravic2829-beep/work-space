"""Link key results to existing tasks."""

import sqlalchemy as sa

from alembic import op

revision = "0020"
down_revision = "0019"


def upgrade() -> None:
    op.create_table(
        "okr_task_links",
        sa.Column(
            "key_result_id",
            sa.Uuid(),
            sa.ForeignKey("okr_key_results.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "record_id",
            sa.Uuid(),
            sa.ForeignKey("records.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index("ix_okr_task_links_record_id", "okr_task_links", ["record_id"])


def downgrade() -> None:
    op.drop_table("okr_task_links")
