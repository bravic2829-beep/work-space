"""timer field: one column holds both moments

The two date columns of the task timer (semantics timer_start and timer_stop) become one column of
the new type `timer`, whose cell is {"started_at", "finished_at"}.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-17 11:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0013"
down_revision: str | Sequence[str] | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TYPE_CHECK = "ck_fields_field_type"
_SEMANTIC_CHECK = "ck_fields_field_semantic"
_TYPES = (
    "'text', 'long_text', 'number', 'date', 'checkbox', 'single_select', 'multi_select', "
    "'status', 'user', 'url', 'link_record', 'created_by', 'created_time', 'auto_number'"
)
_SEMANTICS = "'assignee', 'follower', 'status', 'due_date', 'parent', 'subtasks', 'feedback'"
_TIMER_SEMANTICS = "'timer_start', 'timer_stop'"


def _replace(check: str, column: str, values: str) -> None:
    op.execute(f'ALTER TABLE fields DROP CONSTRAINT "{check}"')
    op.execute(f'ALTER TABLE fields ADD CONSTRAINT "{check}" CHECK ({column} IN ({values}))')


def upgrade() -> None:
    """Upgrade schema."""
    _replace(_TYPE_CHECK, "type", _TYPES + ", 'timer'")

    # The live pairs (start column, stop column) of each table. A table with only half a pair is
    # handled at the end.
    op.execute(
        """
        CREATE TEMP TABLE _timer_pairs ON COMMIT DROP AS
        SELECT s.id AS start_id, e.id AS stop_id, s.table_id
        FROM fields s
        JOIN fields e ON e.table_id = s.table_id
        WHERE s.semantic = 'timer_start' AND s.deleted_at IS NULL
          AND e.semantic = 'timer_stop' AND e.deleted_at IS NULL
        """
    )
    # The cell of every record: both old moments go into the one cell of the start column.
    op.execute(
        """
        UPDATE records r
        SET data = (r.data - p.start_id::text - p.stop_id::text) || jsonb_build_object(
                p.start_id::text,
                jsonb_strip_nulls(jsonb_build_object(
                    'started_at', r.data ->> p.start_id::text,
                    'finished_at', r.data ->> p.stop_id::text
                ))
            ),
            version = r.version + 1
        FROM _timer_pairs p
        WHERE r.table_id = p.table_id
          AND (r.data ? p.start_id::text OR r.data ? p.stop_id::text)
        """
    )
    # The stop column is retired (soft delete, like any column); the start column becomes the timer.
    op.execute(
        "UPDATE fields SET deleted_at = now(), semantic = NULL "
        "WHERE id IN (SELECT stop_id FROM _timer_pairs)"
    )
    op.execute(
        """
        UPDATE fields s
        SET type = 'timer',
            semantic = NULL,
            config = '{}'::jsonb,
            name = CASE WHEN EXISTS (
                SELECT 1 FROM fields x
                WHERE x.table_id = s.table_id AND x.deleted_at IS NULL AND x.id <> s.id
                  AND lower(x.name) = 'timer'
            ) THEN 'Task timer' ELSE 'Timer' END
        WHERE s.id IN (SELECT start_id FROM _timer_pairs)
        """
    )
    # A column left with one of the old roles (a half-made pair, or a deleted column) is only a
    # date column now: its values stay.
    op.execute(f"UPDATE fields SET semantic = NULL WHERE semantic IN ({_TIMER_SEMANTICS})")
    _replace(_SEMANTIC_CHECK, "semantic", _SEMANTICS)


def downgrade() -> None:
    """Downgrade schema.

    Like 0009 this cannot give the columns back: the timer columns are removed with their values.
    """
    _replace(_SEMANTIC_CHECK, "semantic", _SEMANTICS + ", " + _TIMER_SEMANTICS)
    op.execute(
        """
        UPDATE records r
        SET data = r.data - f.id::text
        FROM fields f
        WHERE f.type = 'timer' AND r.table_id = f.table_id AND r.data ? f.id::text
        """
    )
    op.execute("DELETE FROM fields WHERE type = 'timer'")
    _replace(_TYPE_CHECK, "type", _TYPES)
