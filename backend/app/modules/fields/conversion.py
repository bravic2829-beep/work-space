"""Changing the type of a field, and changing its config when records already hold values.

The rules are the table in docs/erd.md 3.3. A change is made only when **every** value that
exists can be converted. Otherwise nothing changes and the error shows a few records that
cannot be converted. Records in the trash are converted too, so that restoring one never
brings back a value of the old type.
"""

import json
import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import array
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.fields.models import Field, FieldType
from app.modules.fields.types import (
    SELECT_TYPES,
    FieldConfigError,
    normalize_config,
    normalize_value,
    text_limit,
)
from app.modules.records.models import Record

CHUNK = 1000
EXAMPLES = 5
REMOVE = object()  # the converted cell is empty: take the key out of the data

# source -> the types it can become (docs/erd.md 3.3). Everything else cannot change type.
ALLOWED: dict[FieldType, set[FieldType]] = {
    FieldType.TEXT: {
        FieldType.LONG_TEXT,
        FieldType.NUMBER,
        FieldType.DATE,
        FieldType.SELECT,
    },
    FieldType.LONG_TEXT: {FieldType.TEXT},
    FieldType.NUMBER: {FieldType.TEXT, FieldType.LONG_TEXT},
    FieldType.DATE: {FieldType.TEXT, FieldType.LONG_TEXT},
    FieldType.SELECT: {FieldType.TEXT, FieldType.LONG_TEXT, FieldType.STATUS},
    FieldType.STATUS: {FieldType.TEXT, FieldType.LONG_TEXT, FieldType.SELECT},
}

Converter = Callable[[Any], Any]


def _option_names(field: Field) -> dict[str, str]:
    return {option["id"]: option["name"] for option in field.config.get("options", [])}


def _number_text(value: Any, precision: int) -> str:
    return f"{value:.{precision}f}" if isinstance(value, float) else str(value)


def _to_text(field: Field) -> Converter:
    """Any readable type to text."""
    names = _option_names(field)
    precision = int(field.config.get("precision", 0))

    def convert(value: Any) -> Any:
        if field.type == FieldType.NUMBER:
            return _number_text(value, precision)
        if field.type == FieldType.STATUS:
            return names.get(value, REMOVE)
        if field.type == FieldType.SELECT:
            return ", ".join(names[item] for item in value if item in names) or REMOVE
        return value

    return convert


def _build_converter(field: Field, new_type: FieldType, new_config: dict[str, Any]) -> Converter:
    old = field.type
    if new_type in (FieldType.TEXT, FieldType.LONG_TEXT):
        to_text = _to_text(field)

        def text_converter(value: Any) -> Any:
            result = to_text(value)
            if result is REMOVE:
                return REMOVE
            limit = text_limit(new_type, new_config)
            if len(result) > limit:
                raise ValueError(f"The text is longer than {limit} characters.")
            return result

        return text_converter

    if new_type in (FieldType.NUMBER, FieldType.DATE):

        def parse(value: Any) -> Any:
            cleaned = str(value).strip()
            if not cleaned:
                return REMOVE
            return normalize_value(new_type, new_config, cleaned)

        return parse

    if old == FieldType.TEXT and new_type == FieldType.SELECT:
        by_name = {option["name"].lower(): option["id"] for option in new_config["options"]}

        def by_option_name(value: Any) -> Any:
            cleaned = str(value).strip()
            if not cleaned:
                return REMOVE
            if cleaned.lower() not in by_name:
                raise ValueError("There is no option with this name.")
            return [by_name[cleaned.lower()]]

        return by_option_name

    if old == FieldType.STATUS and new_type == FieldType.SELECT:  # the option ids are kept
        return lambda value: [value]

    if old == FieldType.SELECT and new_type == FieldType.STATUS:

        def single(value: Any) -> Any:
            if len(value) > 1:
                raise ValueError("More than one value cannot become a single choice.")
            return value[0] if value else REMOVE

        return single

    return lambda value: value  # pragma: no cover


def _target_config(
    field: Field, new_type: FieldType, requested: dict[str, Any] | None
) -> dict[str, Any]:
    """The config of the new type. Select options keep their ids when the old type had options."""
    requested = requested or {}
    try:
        if field.type in SELECT_TYPES and new_type in SELECT_TYPES:
            if "options" in requested:
                return normalize_config(new_type, requested, existing=field.config)
            kept = [
                {k: v for k, v in option.items() if new_type == FieldType.STATUS or k != "kind"}
                for option in field.config.get("options", [])
            ]
            return normalize_config(new_type, {**requested, "options": kept}, existing=field.config)
        if field.type == FieldType.TEXT and new_type == FieldType.SELECT:
            if not requested.get("options"):
                raise FieldConfigError(
                    "Give the options (config.options) that the existing texts should become."
                )
            return normalize_config(new_type, requested)
        return normalize_config(new_type, requested)
    except FieldConfigError as exc:
        raise ProblemError(422, str(exc)) from None


async def change_type(
    session: AsyncSession, field: Field, new_type: FieldType, config: dict[str, Any] | None
) -> None:
    """Change the type of a field and convert every value, or change nothing (409)."""
    if field.semantic is not None or field.grants_view:
        raise ProblemError(
            422, "A field with a role (assignee, status, due date...) cannot change type."
        )
    if new_type not in ALLOWED.get(field.type, set()):
        raise ProblemError(422, f"A {field.type.value} field cannot become a {new_type.value}.")
    new_config = _target_config(field, new_type, config)
    convert = _build_converter(field, new_type, new_config)
    key = str(field.id)

    # Nobody writes a record while the values are converted (a few seconds at most). Writers
    # wait and then see the new type.
    await session.execute(text("LOCK TABLE records IN SHARE ROW EXCLUSIVE MODE"))

    updates: list[dict[str, Any]] = []
    failures = 0
    examples: list[dict[str, str]] = []
    last_id: uuid.UUID | None = None
    while True:
        query = (
            select(Record.id, Record.data[key])
            .where(Record.table_id == field.table_id, Record.data.has_key(key))
            .order_by(Record.id)
            .limit(CHUNK)
        )
        if last_id is not None:
            query = query.where(Record.id > last_id)
        rows = (await session.execute(query)).all()
        if not rows:
            break
        last_id = rows[-1][0]
        for record_id, value in rows:
            try:
                converted = convert(value)
            except ValueError as exc:
                failures += 1
                if len(examples) < EXAMPLES:
                    examples.append({"field": str(record_id), "message": str(exc)})
                continue
            updates.append(
                {"id": record_id, "k": key, "v": json.dumps(converted)}
                if converted is not REMOVE
                else {"id": record_id, "k": key, "v": None}
            )

    if failures:
        raise ProblemError(
            409,
            f"{failures} record(s) have a value that cannot become a {new_type.value}. "
            "Nothing was changed. Some of them are listed in errors (the field is the record id).",
            errors=examples,
        )

    for start in range(0, len(updates), CHUNK):
        batch = updates[start : start + CHUNK]
        keep = [row for row in batch if row["v"] is not None]
        drop = [row for row in batch if row["v"] is None]
        if keep:
            await session.execute(
                text(
                    "UPDATE records SET data = jsonb_set(data, ARRAY[:k], CAST(:v AS jsonb)), "
                    "version = version + 1, updated_at = now() WHERE id = :id"
                ),
                keep,
            )
        if drop:
            await session.execute(
                text(
                    "UPDATE records SET data = data - :k, version = version + 1, "
                    "updated_at = now() WHERE id = :id"
                ),
                [{"id": row["id"], "k": row["k"]} for row in drop],
            )
    field.type = new_type
    field.config = new_config
    await session.flush()


async def _count_records_using(session: AsyncSession, field: Field, condition: Any) -> int:
    result = await session.execute(
        select(func.count()).select_from(Record).where(Record.table_id == field.table_id, condition)
    )
    return int(result.scalar_one())


async def check_removed_options(
    session: AsyncSession, field: Field, new_config: dict[str, Any]
) -> None:
    """Refuse config changes that would contradict the values the records already hold."""
    key = str(field.id)
    if field.type in SELECT_TYPES:
        old_ids = {option["id"] for option in field.config.get("options", [])}
        removed = sorted(old_ids - {option["id"] for option in new_config["options"]})
        if removed:
            if field.type == FieldType.SELECT:
                condition = Record.data[key].has_any(array(removed))
            else:
                condition = Record.data[key].as_string().in_(removed)
            used = await _count_records_using(session, field, condition)
            if used:
                raise ProblemError(
                    409, f"{used} record(s) use an option you want to remove. Change them first."
                )
    elif field.type == FieldType.DATE:
        if new_config["include_time"] != field.config.get("include_time", False):
            if await _count_records_using(session, field, Record.data.has_key(key)):
                raise ProblemError(
                    409, "Dates and times cannot be switched while records hold dates."
                )
    elif field.type == FieldType.USER:
        if not new_config["multiple"] and field.config.get("multiple", True):
            too_many = Record.data[key].as_string().like("%,%")  # more than one id in the list
            if await _count_records_using(session, field, too_many):
                raise ProblemError(
                    409, "Some records name more than one person, so only one is not possible."
                )
