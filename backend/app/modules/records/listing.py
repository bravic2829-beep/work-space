"""The list of records of a table: who sees what, filter, sort and keyset pagination.

The query is built with SQLAlchemy expressions. A field id from the client is only ever used
after it was checked to be a visible column of this table, and it is passed to PostgreSQL as a
bound parameter (`data -> $1`), together with every filter value. Nothing from the client is
put into the SQL text (AGENTS.md: no raw SQL controlled by the client, ADR 0002).
"""

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Numeric,
    and_,
    case,
    cast,
    exists,
    false,
    func,
    literal,
    or_,
    select,
    true,
)

from app.core.errors import ProblemError
from app.core.pagination import decode_cursor, encode_cursor
from app.modules.fields.models import Field, FieldType
from app.modules.fields.types import (
    FieldConfigError,
    normalize_value,
    option_ids,
)
from app.modules.records.models import Record, RecordLink, RecordViewer

MAX_SORT_KEYS = 3
MAX_CONDITIONS = 20
MAX_IN_VALUES = 100

# SQLAlchemy columns and expressions have unrelated static types, so they are typed loosely.
Expression = Any

TEXT_TYPES = {FieldType.TEXT, FieldType.LONG_TEXT, FieldType.URL}
NUMBER_TYPES = {FieldType.NUMBER, FieldType.AUTO_NUMBER}
SELECT_TYPES = {FieldType.SINGLE_SELECT, FieldType.STATUS}
LIST_TYPES = {FieldType.MULTI_SELECT, FieldType.USER}

_ORDER_OPS = ("gt", "gte", "lt", "lte")
OPERATORS: dict[FieldType, tuple[str, ...]] = {
    FieldType.TEXT: ("eq", "neq", "contains", "is_empty", "is_not_empty"),
    FieldType.LONG_TEXT: ("eq", "neq", "contains", "is_empty", "is_not_empty"),
    FieldType.URL: ("eq", "neq", "contains", "is_empty", "is_not_empty"),
    FieldType.NUMBER: ("eq", "neq", *_ORDER_OPS, "is_empty", "is_not_empty"),
    FieldType.AUTO_NUMBER: ("eq", "neq", *_ORDER_OPS),
    FieldType.DATE: ("eq", "neq", *_ORDER_OPS, "is_empty", "is_not_empty"),
    FieldType.CREATED_TIME: ("eq", "neq", *_ORDER_OPS),
    FieldType.CHECKBOX: ("eq", "neq"),
    FieldType.SINGLE_SELECT: ("eq", "neq", "in", "is_empty", "is_not_empty"),
    FieldType.STATUS: ("eq", "neq", "in", "is_empty", "is_not_empty"),
    FieldType.MULTI_SELECT: ("contains", "is_empty", "is_not_empty"),
    FieldType.USER: ("contains", "is_empty", "is_not_empty"),
    FieldType.CREATED_BY: ("eq", "neq", "in"),
    FieldType.LINK_RECORD: ("contains", "is_empty", "is_not_empty"),
    FieldType.TIMER: ("is_empty", "is_not_empty"),
}
SORTABLE = (
    TEXT_TYPES
    | NUMBER_TYPES
    | SELECT_TYPES
    | {FieldType.DATE, FieldType.CHECKBOX, FieldType.CREATED_TIME}
)


def _unknown(name: str) -> ProblemError:
    return ProblemError(
        422,
        "One or more parameters are invalid.",
        errors=[{"field": name, "message": "Unknown field."}],
    )


def _bad(name: str, message: str) -> ProblemError:
    return ProblemError(
        422, "One or more parameters are invalid.", errors=[{"field": name, "message": message}]
    )


# --- reading a column of the JSONB data ------------------------------------------------------


def _text(field: Field) -> Expression:
    # `.astext` is `data ->> key`. (`.as_string()` adds a CAST to VARCHAR, and a cast of that to
    # NUMERIC no longer matches an index on `(data ->> key)::numeric`.)
    return Record.data[str(field.id)].astext


def value_expression(field: Field) -> Expression:
    """The column as a typed SQL value, for comparing and sorting."""
    key = str(field.id)
    if field.type in NUMBER_TYPES:
        return cast(Record.data[key].astext, Numeric)
    if field.type == FieldType.CHECKBOX:
        return func.coalesce(cast(Record.data[key].astext, Boolean), false())
    if field.type == FieldType.CREATED_TIME:
        return Record.created_at
    if field.type == FieldType.CREATED_BY:
        return Record.created_by
    return Record.data[key].astext


def _is_empty(field: Field) -> Expression:
    if field.type == FieldType.LINK_RECORD:
        return ~_has_link(field, None)
    key = str(field.id)
    # astext is NULL for a JSON null and the text of an array (`[]`) or string (empty).
    text_value = Record.data[key].astext
    return or_(~Record.data.has_key(key), text_value.is_(None), text_value.in_(["", "[]"]))


def _has_link(field: Field, target: uuid.UUID | None) -> Expression:
    conditions = [RecordLink.field_id == field.id, RecordLink.source_record_id == Record.id]
    if target is not None:
        conditions.append(RecordLink.target_record_id == target)
    return exists().where(*conditions)


# --- filters ---------------------------------------------------------------------------------


def _clean_value(field: Field, op: str, value: Any, name: str) -> Any:
    """Check a filter value the way a cell value is checked."""
    if field.type == FieldType.CHECKBOX:
        if not isinstance(value, bool):
            raise _bad(name, "Must be true or false.")
        return value
    try:
        if field.type == FieldType.CREATED_TIME:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        if field.type == FieldType.AUTO_NUMBER:
            return Decimal(str(normalize_value(FieldType.NUMBER, {"precision": 0}, value)))
        if field.type == FieldType.NUMBER:
            return Decimal(str(normalize_value(FieldType.NUMBER, {"precision": 10}, value)))
        if field.type == FieldType.DATE:
            return normalize_value(FieldType.DATE, field.config, value)
        if field.type in TEXT_TYPES:
            if not isinstance(value, str):
                raise ValueError("Must be text.")
            if "\x00" in value:
                raise ValueError("Text cannot contain the NUL character.")
            return value
        if field.type in SELECT_TYPES or field.type == FieldType.MULTI_SELECT:
            if not isinstance(value, str) or value not in option_ids(field.config):
                raise ValueError("Must be the id of one of the options.")
            return value
        if field.type in (FieldType.USER, FieldType.CREATED_BY, FieldType.LINK_RECORD):
            return uuid.UUID(str(value))
    except (ValueError, FieldConfigError, TypeError) as exc:
        raise _bad(name, str(exc) or "Not a valid value.") from None
    raise _bad(name, "This column cannot be filtered.")  # pragma: no cover


def parse_filter(raw: str | None, fields: dict[str, Field]) -> list[Expression]:
    """The `filter` parameter: a JSON list of {field, op, value}, all of which must match."""
    if raw is None or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except ValueError:
        raise ProblemError(400, "The filter is not valid JSON.") from None
    if not isinstance(parsed, list) or not all(isinstance(item, dict) for item in parsed):
        raise ProblemError(400, "The filter must be a list of {field, op, value}.")
    if len(parsed) > MAX_CONDITIONS:
        raise ProblemError(422, f"A filter can have at most {MAX_CONDITIONS} conditions.")

    conditions: list[Expression] = []
    for item in parsed:
        if set(item) - {"field", "op", "value"}:
            raise _bad("filter", "A condition has only field, op and value.")
        key = item.get("field")
        field = fields.get(str(key))
        if field is None:
            raise _unknown("filter")
        name = f"filter.{key}"
        op = item.get("op")
        if op not in OPERATORS[field.type]:
            allowed = ", ".join(OPERATORS[field.type])
            raise _bad(name, f"The operator must be one of: {allowed}.")
        conditions.append(_condition(field, str(op), item.get("value"), name))
    return conditions


def _condition(field: Field, op: str, value: Any, name: str) -> Expression:
    if op == "is_empty":
        return _is_empty(field)
    if op == "is_not_empty":
        return ~_is_empty(field)
    if op == "in":
        if not isinstance(value, list) or not 0 < len(value) <= MAX_IN_VALUES:
            raise _bad(name, f"Must be a list of 1 to {MAX_IN_VALUES} values.")
        cleaned = [_clean_value(field, op, item, name) for item in value]
        return value_expression(field).in_(cleaned)

    clean = _clean_value(field, op, value, name)
    if field.type == FieldType.LINK_RECORD:
        return _has_link(field, clean)
    if field.type == FieldType.MULTI_SELECT or field.type == FieldType.USER:
        return Record.data.contains({str(field.id): [str(clean)]})
    expression = value_expression(field)
    if field.type == FieldType.CREATED_BY:
        return expression == clean if op == "eq" else expression != clean
    if op == "eq":
        return expression == clean
    if op == "neq":
        return expression.is_distinct_from(clean)
    if op == "contains":
        return expression.icontains(clean, autoescape=True)
    return {
        "gt": expression > clean,
        "gte": expression >= clean,
        "lt": expression < clean,
        "lte": expression <= clean,
    }[op]


# --- sorting and the cursor ------------------------------------------------------------------


@dataclass(frozen=True)
class SortKey:
    label: str  # "<field id>:asc"
    expression: Expression
    descending: bool
    kind: str  # how the value is written in the cursor: text, num, bool, ts, uuid


def _kind(field: Field | None) -> str:
    if field is None:
        return "ts"
    if field.type in NUMBER_TYPES or field.type in SELECT_TYPES:
        return "num"
    if field.type == FieldType.CHECKBOX:
        return "bool"
    if field.type == FieldType.CREATED_TIME:
        return "ts"
    return "text"


def _sort_expression(field: Field) -> Expression:
    if field.type in SELECT_TYPES:
        # By the order of the options in the settings, not by the alphabet of their ids.
        options = field.config.get("options", [])
        if not options:
            return literal(0)
        return case(
            {option["id"]: index for index, option in enumerate(options)},
            value=_text(field),
            else_=None,
        )
    return value_expression(field)


def parse_sort(raw: list[str], fields: dict[str, Field]) -> list[SortKey]:
    if len(raw) > MAX_SORT_KEYS:
        raise ProblemError(422, f"At most {MAX_SORT_KEYS} sort columns are allowed.")
    keys: list[SortKey] = []
    seen: set[str] = set()
    for item in raw:
        field_id, _, direction = item.partition(":")
        direction = direction or "asc"
        field = fields.get(field_id)
        if field is None:
            raise _unknown("sort")
        if direction not in ("asc", "desc"):
            raise _bad("sort", "The direction must be asc or desc.")
        if field.type not in SORTABLE:
            raise _bad("sort", "This column cannot be sorted.")
        if field_id in seen:
            raise _bad("sort", "A column can be sorted once.")
        seen.add(field_id)
        keys.append(
            SortKey(
                f"{field_id}:{direction}",
                _sort_expression(field),
                direction == "desc",
                _kind(field),
            )
        )
    return keys


def _encode_value(kind: str, value: Any) -> Any:
    if value is None:
        return None
    if kind == "ts":
        return value.isoformat()
    return str(value) if kind == "num" else value


def _decode_value(kind: str, value: Any) -> Any:
    """A value read back from a cursor. The client can forge a cursor, so every kind is parsed
    defensively and a bad one is a 422, never a server error."""
    if value is None:
        return None
    try:
        if kind == "num":
            return Decimal(str(value))
        if kind == "ts":
            parsed = datetime.fromisoformat(str(value))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        if kind == "bool":
            return bool(value)
        if kind == "uuid":
            return uuid.UUID(str(value))
        return str(value)
    except (ValueError, ArithmeticError):
        raise ProblemError(422, "The cursor is not valid.") from None


def _bound(kind: str, value: Any) -> Any:
    """A cursor value as a typed bind parameter (a bare True or a datetime would not compare)."""
    if kind == "ts":
        return literal(value, DateTime(timezone=True))
    if kind == "bool":
        return literal(value, Boolean())
    return value


def _after(expression: Expression, kind: str, value: Any, descending: bool) -> Expression:
    """Rows that come after `value` in this column. NULLs are always last."""
    if value is None:
        return false()
    bound = _bound(kind, value)
    ahead = expression < bound if descending else expression > bound
    return or_(ahead, expression.is_(None))


def _same(expression: Expression, kind: str, value: Any) -> Expression:
    if value is None:
        return expression.is_(None)
    return expression == _bound(kind, value)


def make_cursor(signature: str, values: list[Any]) -> str:
    return encode_cursor(json.dumps({"s": signature, "v": values}))


def read_cursor(raw: str, signature: str, count: int) -> list[Any]:
    try:
        payload = json.loads(decode_cursor(raw))
        values = payload["v"]
        same = payload["s"] == signature
    except (ValueError, KeyError, TypeError):
        raise ProblemError(422, "The cursor is not valid.") from None
    if not same or not isinstance(values, list) or len(values) != count:
        raise ProblemError(422, "The cursor does not belong to this request.")
    return values


# --- the query -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Listing:
    query: Any
    keys: list[SortKey]
    signature: str


def build_query(
    *,
    table_id: uuid.UUID,
    viewer_id: uuid.UUID | None,
    filters: list[Expression],
    sort: list[SortKey],
    cursor: str | None,
    limit: int,
) -> Listing:
    """The records query. `viewer_id` is given when the person only sees what they are named in
    (people who see everything pass None)."""
    # Whatever the sort, the order ends with created_at and id, so it is total and stable.
    keys = [
        *sort,
        SortKey("created_at:asc", Record.created_at, False, "ts"),
        SortKey("id:asc", Record.id, False, "uuid"),
    ]
    signature = "|".join(key.label for key in keys)

    columns = [key.expression.label(f"k{index}") for index, key in enumerate(keys)]
    query = select(Record, *columns).where(Record.table_id == table_id, Record.deleted_at.is_(None))
    if viewer_id is not None:
        query = query.where(
            exists().where(RecordViewer.record_id == Record.id, RecordViewer.user_id == viewer_id)
        )
    for condition in filters:
        query = query.where(condition)

    if cursor is not None:
        values = read_cursor(cursor, signature, len(keys))
        decoded = [_decode_value(key.kind, v) for key, v in zip(keys, values, strict=True)]
        alternatives: list[Expression] = []
        for index, key in enumerate(keys):
            equal_before = [
                _same(keys[i].expression, keys[i].kind, decoded[i]) for i in range(index)
            ]
            alternatives.append(
                and_(
                    *equal_before, _after(key.expression, key.kind, decoded[index], key.descending)
                )
                if equal_before
                else _after(key.expression, key.kind, decoded[index], key.descending)
            )
        query = query.where(or_(*alternatives) if alternatives else true())

    for key in keys:
        ordering = key.expression.desc() if key.descending else key.expression.asc()
        query = query.order_by(ordering.nulls_last())
    return Listing(query.limit(limit + 1), keys, signature)


def cursor_for(listing: Listing, row: Any) -> str:
    """The cursor that continues after this row (the last one shown)."""
    values = [
        str(row[index + 1]) if key.kind == "uuid" else _encode_value(key.kind, row[index + 1])
        for index, key in enumerate(listing.keys)
    ]
    return make_cursor(listing.signature, values)
