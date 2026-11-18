"""Rules a column puts on its values, checked against the values that already exist.

Changing a column so that its existing values break the rule is refused (409, nothing changes),
the same way removing an option that records use is refused (`conversion.check_removed_options`).
Writing a value that breaks `unique` is refused by `ensure_unique`, which also serializes the
writers of one column so that two records cannot take the same value at the same time.
"""

import uuid
from typing import Any

from sqlalchemy import Numeric, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.fields.models import Field, FieldType
from app.modules.fields.types import FORMAT_PATTERNS, text_format, text_limit
from app.modules.records.models import Record


async def _count(session: AsyncSession, field: Field, *conditions: Any) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Record)
        .where(
            Record.table_id == field.table_id,
            Record.deleted_at.is_(None),
            Record.data.has_key(str(field.id)),
            *conditions,
        )
    )
    return int(result.scalar_one())


def _refuse(count: int, what: str) -> ProblemError:
    return ProblemError(
        409, f"{count} record(s) {what}, so this change was not made. Fix them first."
    )


async def check_config(
    session: AsyncSession, field: Field, new_type: FieldType, new_config: dict[str, Any]
) -> None:
    """Refuse a config change that the values of the records already contradict."""
    key = str(field.id)
    value = Record.data[key].astext
    if new_type in (FieldType.TEXT, FieldType.LONG_TEXT):
        limit = text_limit(new_type, new_config)
        too_long = await _count(session, field, func.char_length(value) > limit)
        if too_long:
            raise _refuse(too_long, f"hold more than {limit} characters")
        kind = text_format(new_config)
        if new_type == FieldType.TEXT and kind != "plain":
            bad = await _count(session, field, value != "", value.op("!~*")(FORMAT_PATTERNS[kind]))
            if bad:
                raise _refuse(bad, f"hold a value that is not a valid {kind}")
    elif new_type == FieldType.NUMBER:
        number = cast(value, Numeric)
        low, high = new_config.get("min"), new_config.get("max")
        if low is not None:
            below = await _count(session, field, number < low)
            if below:
                raise _refuse(below, f"hold a number below {low}")
        if high is not None:
            above = await _count(session, field, number > high)
            if above:
                raise _refuse(above, f"hold a number above {high}")
    elif new_type == FieldType.SELECT and not new_config.get("multiple", False):
        # A list with two or more entries has a comma between the ids.
        many = await _count(session, field, value.like("%,%"))
        if many:
            raise _refuse(many, "name more than one option")


async def check_unique(session: AsyncSession, field: Field) -> None:
    """Refuse to make a column unique while two live records share a value."""
    key = str(field.id)
    value = Record.data[key].astext  # one expression: one bound key, so GROUP BY matches SELECT
    shared = (
        select(value)
        .where(
            Record.table_id == field.table_id,
            Record.deleted_at.is_(None),
            Record.data.has_key(key),
        )
        .group_by(value)
        .having(func.count() > 1)
        .subquery()
    )
    duplicated = (await session.execute(select(func.count()).select_from(shared))).scalar_one()
    if duplicated:
        raise ProblemError(
            409,
            f"{duplicated} value(s) of this column are used by more than one record, "
            "so it cannot be unique. Fix them first.",
        )


async def ensure_unique(
    session: AsyncSession,
    fields: list[Field],
    values: dict[str, Any],
    *,
    table_id: uuid.UUID,
    except_record: uuid.UUID | None = None,
) -> None:
    """Refuse a write when a unique column would hold a value another live record already has.

    `values` maps field id to the new clean value. Writers of the same column take a
    transaction-scoped advisory lock first, so that two of them cannot both pass the check.
    """
    errors: list[dict[str, str]] = []
    for column in sorted((f for f in fields if f.is_unique), key=lambda f: str(f.id)):
        key = str(column.id)
        if key not in values:
            continue
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key}
        )
        query = select(Record.id).where(
            Record.table_id == table_id,
            Record.deleted_at.is_(None),
            Record.data.contains({key: values[key]}),
        )
        if except_record is not None:
            query = query.where(Record.id != except_record)
        if (await session.execute(query.limit(1))).first() is not None:
            errors.append({"field": key, "message": "Another record already has this value."})
    if errors:
        raise ProblemError(422, "One or more values are invalid.", errors=errors)
