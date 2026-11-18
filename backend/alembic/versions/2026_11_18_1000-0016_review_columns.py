"""review columns: a score and two notes for the review of finished work

Three more column roles: `review_score`, `review_merits` and `review_improve`. Every task table
(one with an assignee and a status column) that does not have them yet gets the three columns, at
the end. The person who does the work can read them but not write them (like the feedback).

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-18 10:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "ck_fields_field_semantic"
_OLD = "'assignee', 'follower', 'status', 'due_date', 'parent', 'subtasks', 'feedback'"
_NEW = _OLD + ", 'review_score', 'review_merits', 'review_improve'"

# (name, type, config, semantic)
_COLUMNS = (
    ("Review score (0-1)", "number", '{"precision": 1}', "review_score"),
    ("Review: merits", "long_text", "{}", "review_merits"),
    ("Review: to improve", "long_text", "{}", "review_improve"),
)


def _set_semantics(values: str) -> None:
    op.execute(f'ALTER TABLE fields DROP CONSTRAINT "{_CHECK}"')
    op.execute(f'ALTER TABLE fields ADD CONSTRAINT "{_CHECK}" CHECK (semantic IN ({values}))')


def _add_column(name: str, field_type: str, config: str, semantic: str) -> None:
    """Add one column to every task table that has no column with this role. A name that is
    already taken in the table gets " (review)" after it: column names are unique in a table."""
    op.execute(
        f"""
        INSERT INTO fields (table_id, name, type, config, semantic, grants_view, is_required,
                            position)
        SELECT t.id,
               CASE WHEN EXISTS (
                   SELECT 1 FROM fields x
                   WHERE x.table_id = t.id AND x.deleted_at IS NULL
                     AND lower(x.name) = lower('{name}')
               ) THEN '{name} (review)' ELSE '{name}' END,
               '{field_type}', '{config}'::jsonb, '{semantic}', false, false,
               COALESCE((SELECT max(p.position) FROM fields p WHERE p.table_id = t.id), 0) + 1
        FROM tables t
        WHERE t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM fields s WHERE s.table_id = t.id
                      AND s.semantic = 'status' AND s.deleted_at IS NULL)
          AND EXISTS (SELECT 1 FROM fields a WHERE a.table_id = t.id
                      AND a.semantic = 'assignee' AND a.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM fields r WHERE r.table_id = t.id
                          AND r.semantic = '{semantic}' AND r.deleted_at IS NULL)
        """
    )


def upgrade() -> None:
    """Upgrade schema."""
    _set_semantics(_NEW)
    for column in _COLUMNS:
        _add_column(*column)


def downgrade() -> None:
    """Downgrade schema."""
    # The columns go (the values stay in the records' data, unreachable, as for any removed role).
    op.execute(
        "DELETE FROM fields WHERE semantic IN ('review_score', 'review_merits', 'review_improve')"
    )
    _set_semantics(_OLD)
