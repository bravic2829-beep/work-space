"""Which column names a record: the first text column of the table."""

from typing import Any

from app.modules.fields.models import Field, FieldType


def title_field(fields: list[Field]) -> Field | None:
    texts = [f for f in fields if f.type == FieldType.TEXT and f.deleted_at is None]
    return min(texts, key=lambda f: f.position) if texts else None


def title_of(fields: list[Field], data: dict[str, Any]) -> str | None:
    """The record's name, or None when the table has no text column or the cell is empty."""
    column = title_field(fields)
    if column is None or str(column.id) not in data:
        return None
    return str(data[str(column.id)])
