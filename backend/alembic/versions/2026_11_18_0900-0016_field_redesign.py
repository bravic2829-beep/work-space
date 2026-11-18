"""field redesign: one select type, url inside text, shared column properties

- `single_select` and `multi_select` become one type, `select`, with `config.multiple`. A cell
  always holds a list of option ids, so a single choice is wrapped in a list.
- `url` becomes a `text` column with `config.format = "url"`.
- A date column that was filled when a record is made (`config.fill = "created"`) becomes a
  `created_time` column. When it has a role (a due date) it stays a date and only loses `fill`.
- New columns on `fields`: `is_unique`, `default_value`, `description`.
- Columns that cannot be required (checkbox, system made, endpoint written) lose the flag.
- Options that have no color get one (the color of their kind, or the next color of a palette).

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-18 09:00:00.000000

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TYPE = "ck_fields_field_type"
_TYPES_OLD = (
    "'text', 'long_text', 'number', 'date', 'checkbox', 'single_select', 'multi_select', "
    "'status', 'user', 'url', 'link_record', 'created_by', 'created_time', 'auto_number', "
    "'timer', 'attachment'"
)
_TYPES_NEW = (
    "'text', 'long_text', 'number', 'date', 'checkbox', 'select', 'status', 'user', "
    "'link_record', 'created_by', 'created_time', 'auto_number', 'timer', 'attachment'"
)

# The same palette and kind colors as app.modules.fields.types (a migration must not import the
# app: the app changes, the migration must not).
_PALETTE = [
    "#e5484d",
    "#f76808",
    "#f5a623",
    "#e5c100",
    "#46a758",
    "#12a594",
    "#0b9cd8",
    "#3e63dd",
    "#6e56cf",
    "#d6409f",
    "#8b97a3",
    "#3d4852",
]
_KIND_COLORS = {
    "todo": "#8b97a3",
    "in_progress": "#3e63dd",
    "review": "#f5a623",
    "done": "#46a758",
    "paused": "#6e56cf",
    "blocked": "#e5484d",
}
_NOT_REQUIRED = (
    "'checkbox', 'auto_number', 'created_by', 'created_time', 'timer', 'attachment', 'link_record'"
)


def _add_constraint(values: str) -> None:
    op.execute(f'ALTER TABLE fields ADD CONSTRAINT "{_TYPE}" CHECK (type IN ({values}))')


def _give_colors() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, config FROM fields WHERE type IN ('select', 'status') "
            "AND jsonb_typeof(config -> 'options') = 'array'"
        )
    ).all()
    for field_id, config in rows:
        options = config.get("options", [])
        if all(option.get("color") for option in options):
            continue
        for index, option in enumerate(options):
            if option.get("color"):
                continue
            kind = option.get("kind")
            option["color"] = _KIND_COLORS.get(kind) or _PALETTE[index % len(_PALETTE)]
        bind.execute(
            sa.text("UPDATE fields SET config = CAST(:config AS jsonb) WHERE id = :id"),
            {"config": json.dumps(config), "id": field_id},
        )


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "fields",
        sa.Column("is_unique", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "fields",
        sa.Column("default_value", postgresql.JSONB(none_as_null=True, astext_type=sa.Text())),
    )
    op.add_column("fields", sa.Column("description", sa.String(length=500)))

    op.execute(f'ALTER TABLE fields DROP CONSTRAINT "{_TYPE}"')

    # A single choice was a string: it becomes a list of one. (Trashed records are converted too,
    # so that restoring one never brings back a cell of the old shape.)
    op.execute(
        """
        UPDATE records r
        SET data = jsonb_set(
                r.data, ARRAY[f.id::text], jsonb_build_array(r.data -> f.id::text)
            ),
            version = r.version + 1
        FROM fields f
        WHERE f.type = 'single_select' AND f.table_id = r.table_id
          AND jsonb_typeof(r.data -> f.id::text) = 'string'
        """
    )
    op.execute(
        """
        UPDATE fields
        SET type = 'select', config = config || '{"multiple": false}'::jsonb
        WHERE type = 'single_select'
        """
    )
    op.execute(
        """
        UPDATE fields
        SET type = 'select', config = config || '{"multiple": true}'::jsonb
        WHERE type = 'multi_select'
        """
    )
    op.execute(
        """
        UPDATE fields
        SET type = 'text', config = '{"format": "url", "max_length": 2048}'::jsonb
        WHERE type = 'url'
        """
    )
    # Filled on creation: the creation time of the record says the same thing.
    op.execute(
        """
        UPDATE fields
        SET type = 'created_time', config = '{}'::jsonb
        WHERE type = 'date' AND config ->> 'fill' = 'created' AND semantic IS NULL
        """
    )
    op.execute("UPDATE fields SET config = config - 'fill' WHERE type = 'date'")
    op.execute(f"UPDATE fields SET is_required = false WHERE type IN ({_NOT_REQUIRED})")

    _add_constraint(_TYPES_NEW)
    _give_colors()


def downgrade() -> None:
    """Downgrade schema.

    A date column that was turned into `created_time` stays one (the old `fill` is not brought
    back), and a text column in the email or phone format becomes plain text.
    """
    op.execute(f'ALTER TABLE fields DROP CONSTRAINT "{_TYPE}"')

    # A list of one goes back to a string. An empty list is no value.
    op.execute(
        """
        UPDATE records r
        SET data = jsonb_set(r.data, ARRAY[f.id::text], r.data -> f.id::text -> 0),
            version = r.version + 1
        FROM fields f
        WHERE f.type = 'select' AND f.table_id = r.table_id
          AND COALESCE((f.config ->> 'multiple')::boolean, false) = false
          AND jsonb_typeof(r.data -> f.id::text) = 'array'
          AND jsonb_array_length(r.data -> f.id::text) = 1
        """
    )
    op.execute(
        """
        UPDATE records r
        SET data = r.data - f.id::text, version = r.version + 1
        FROM fields f
        WHERE f.type = 'select' AND f.table_id = r.table_id
          AND COALESCE((f.config ->> 'multiple')::boolean, false) = false
          AND jsonb_typeof(r.data -> f.id::text) = 'array'
          AND jsonb_array_length(r.data -> f.id::text) = 0
        """
    )
    op.execute(
        """
        UPDATE fields
        SET type = CASE WHEN COALESCE((config ->> 'multiple')::boolean, false)
                        THEN 'multi_select' ELSE 'single_select' END,
            config = config - 'multiple'
        WHERE type = 'select'
        """
    )
    op.execute(
        """
        UPDATE fields SET type = 'url', config = '{}'::jsonb
        WHERE type = 'text' AND config ->> 'format' = 'url'
        """
    )
    op.execute(
        """
        UPDATE fields SET config = config - 'format'
        WHERE type = 'text' AND config ? 'format'
        """
    )
    _add_constraint(_TYPES_OLD)

    op.drop_column("fields", "description")
    op.drop_column("fields", "default_value")
    op.drop_column("fields", "is_unique")
