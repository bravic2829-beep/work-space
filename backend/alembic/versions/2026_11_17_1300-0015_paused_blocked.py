"""paused and blocked task states

The status column gets two more kinds, `paused` and `blocked`. Every status column that exists
gets one option of each kind (a new table gets them from the defaults). A blocker is told to the
creator through a new notification type, and the three new steps are written to the history.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-17 13:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOTE = "ck_notifications_notification_type"
_NOTE_OLD = "'task_assigned', 'review_requested', 'changes_requested'"
_NOTE_NEW = _NOTE_OLD + ", 'task_blocked'"
_ACTION = "ck_activity_log_activity_action"
_ACTIONS_OLD = (
    "'created', 'updated', 'submitted', 'approved', 'sent_back', 'timer_started', "
    "'timer_stopped', 'handed_over', 'attachment_added', 'attachment_removed'"
)
_ACTIONS_NEW = _ACTIONS_OLD + ", 'paused', 'blocked', 'resumed'"


def _widen(table: str, constraint: str, column: str, values: str) -> None:
    op.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{constraint}"')
    op.execute(f'ALTER TABLE {table} ADD CONSTRAINT "{constraint}" CHECK ({column} IN ({values}))')


def _add_option(kind: str, name: str, name_if_taken: str) -> None:
    """Give every live status column one option of this kind, when it has none."""
    op.execute(
        f"""
        UPDATE fields f
        SET config = jsonb_set(
            f.config,
            '{{options}}',
            (f.config -> 'options') || jsonb_build_array(jsonb_build_object(
                'id', replace(gen_random_uuid()::text, '-', ''),
                'name', CASE WHEN EXISTS (
                        SELECT 1 FROM jsonb_array_elements(f.config -> 'options') o
                        WHERE lower(o ->> 'name') = lower('{name}')
                    ) THEN '{name_if_taken}' ELSE '{name}' END,
                'kind', '{kind}'
            ))
        )
        WHERE f.type = 'status' AND f.deleted_at IS NULL
          AND jsonb_typeof(f.config -> 'options') = 'array'
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(f.config -> 'options') o
              WHERE o ->> 'kind' = '{kind}'
          )
        """
    )


def upgrade() -> None:
    """Upgrade schema."""
    _widen("notifications", _NOTE, "type", _NOTE_NEW)
    _widen("activity_log", _ACTION, "action", _ACTIONS_NEW)
    _add_option("paused", "Paused", "Paused (on hold)")
    _add_option("blocked", "Blocked", "Blocked (stuck)")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM notifications WHERE type = 'task_blocked'")
    op.execute("DELETE FROM activity_log WHERE action IN ('paused', 'blocked', 'resumed')")
    _widen("notifications", _NOTE, "type", _NOTE_OLD)
    _widen("activity_log", _ACTION, "action", _ACTIONS_OLD)

    # A task on a paused or blocked option goes back to the "in progress" option of its column,
    # then the two options go away.
    op.execute(
        """
        UPDATE records r
        SET data = jsonb_set(r.data, ARRAY[f.id::text], to_jsonb(
                (SELECT o ->> 'id' FROM jsonb_array_elements(f.config -> 'options') o
                 WHERE o ->> 'kind' = 'in_progress' LIMIT 1)
            )),
            version = r.version + 1
        FROM fields f
        WHERE f.type = 'status' AND f.table_id = r.table_id
          AND jsonb_typeof(f.config -> 'options') = 'array'
          AND (r.data ->> f.id::text) IN (
              SELECT o ->> 'id' FROM jsonb_array_elements(f.config -> 'options') o
              WHERE o ->> 'kind' IN ('paused', 'blocked')
          )
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(f.config -> 'options') o
              WHERE o ->> 'kind' = 'in_progress'
          )
        """
    )
    op.execute(
        """
        UPDATE fields f
        SET config = jsonb_set(
            f.config,
            '{options}',
            COALESCE((
                SELECT jsonb_agg(o)
                FROM jsonb_array_elements(f.config -> 'options') o
                WHERE o ->> 'kind' NOT IN ('paused', 'blocked')
            ), '[]'::jsonb)
        )
        WHERE f.type = 'status' AND jsonb_typeof(f.config -> 'options') = 'array'
        """
    )
