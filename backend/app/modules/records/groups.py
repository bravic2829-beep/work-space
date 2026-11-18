"""The records of a table folded into groups, each with its number of records and totals.

A group is one value of one column ("Status = Blocked", "Parent task = Launch", "Due in November").
The rows of a group are not read here: each group comes with the filter that selects its records,
so the page asks the normal record list for the rows of a group when it is opened. That keeps big
tables fast, and every number counts the whole group, not only the page that was loaded.

The same rules as the record list apply (ADR 0002):
- only the tasks the caller may open are counted;
- only columns the caller may see can be grouped or totalled (a hidden column is "unknown", so
  nothing hidden can be worked out from the groups);
- a link only names a record the caller may open;
- every field id and value reaches PostgreSQL as a bound parameter, never as SQL text.

A record with several values in the grouped column (two assignees, two tags, two links) is counted
in each of its groups, so the counts of the groups can add up to more than the records.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from pydantic import BaseModel
from sqlalchemy import Date, Numeric, String, and_, case, cast, exists, func, literal, select, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.fields import repository as fields_repo
from app.modules.fields.models import Field, FieldAccessLevel, FieldType
from app.modules.fields.titles import title_field
from app.modules.permissions.service import TableContext, is_org_admin
from app.modules.records import listing
from app.modules.records.models import Record, RecordLink, RecordViewer
from app.modules.users.models import User

MAX_GROUPS = 200
MAX_AGGREGATES = 10
BUCKETS = ("day", "week", "month")
FUNCTIONS = ("sum", "avg", "min", "max")
EMPTY = "(empty)"

GROUPABLE = (
    listing.TEXT_TYPES
    | listing.NUMBER_TYPES
    | {
        FieldType.SINGLE_SELECT,
        FieldType.STATUS,
        FieldType.MULTI_SELECT,
        FieldType.USER,
        FieldType.CREATED_BY,
        FieldType.LINK_RECORD,
        FieldType.DATE,
        FieldType.CREATED_TIME,
        FieldType.CHECKBOX,
    }
)
_DATED = (FieldType.DATE, FieldType.CREATED_TIME)
_LISTED = (FieldType.USER, FieldType.MULTI_SELECT)
_OPTIONS = (FieldType.SINGLE_SELECT, FieldType.STATUS, FieldType.MULTI_SELECT)


class GroupTotal(BaseModel):
    field_id: uuid.UUID
    fn: str
    # None: no task of the group has a value in this column.
    value: float | None


class Group(BaseModel):
    # The value of the group: an option id, a person's id, a record id, a date bucket ("2026-11"),
    # a text, "true" or "false"; None for the tasks with no value.
    key: str | None
    label: str
    count: int
    totals: list[GroupTotal]
    # The conditions that select the records of this group, ready for the record list's `filter`.
    # None when the group cannot be opened (its value no longer exists, e.g. a removed option).
    filter: list[dict[str, Any]] | None


class Groups(BaseModel):
    group_by: uuid.UUID
    bucket: str | None
    # How many tasks match the filter (before folding them into groups).
    total: int
    # True when there were more than MAX_GROUPS groups and the rest are left out.
    truncated: bool
    groups: list[Group]


def _bad(name: str, message: str) -> ProblemError:
    return listing._bad(name, message)


# --- what the request asks for ------------------------------------------------------------------


def _bucket_for(field: Field, bucket: str | None) -> str | None:
    if field.type in _DATED:
        chosen = bucket or "month"
        if chosen not in BUCKETS:
            raise _bad("bucket", f"Must be one of: {', '.join(BUCKETS)}.")
        return chosen
    if bucket is not None:
        raise _bad("bucket", "Only a date column is grouped by day, week or month.")
    return None


def _parse_totals(specs: list[str], by_id: dict[str, Field]) -> list[tuple[Field, str]]:
    if len(specs) > MAX_AGGREGATES:
        raise _bad("aggregate", f"At most {MAX_AGGREGATES} totals can be asked for.")
    parsed: list[tuple[Field, str]] = []
    for spec in specs:
        key, _, fn = spec.partition(":")
        field = by_id.get(key)
        if field is None:
            raise listing._unknown("aggregate")
        if fn not in FUNCTIONS:
            raise _bad("aggregate", f"The function must be one of: {', '.join(FUNCTIONS)}.")
        if field.type not in listing.NUMBER_TYPES:
            raise _bad("aggregate", "Only a number column can be totalled.")
        parsed.append((field, fn))
    return parsed


# --- the group key ------------------------------------------------------------------------------


def _day_text(field: Field) -> Any:
    """The day of a date column as text (YYYY-MM-DD), whether or not it holds a time."""
    if field.type == FieldType.CREATED_TIME:
        return func.to_char(Record.created_at, "YYYY-MM-DD")
    return func.substr(listing._text(field), 1, 10)


def _bucketed(field: Field, bucket: str) -> Any:
    day = _day_text(field)
    if bucket == "day":
        return day
    if bucket == "month":
        return func.substr(day, 1, 7)
    return func.to_char(func.date_trunc("week", cast(day, Date)), "YYYY-MM-DD")


def _scalar_key(field: Field, bucket: str | None) -> Any:
    if field.type in _DATED and bucket:
        return _bucketed(field, bucket)
    if field.type == FieldType.CREATED_BY:
        return cast(Record.created_by, String)
    if field.type == FieldType.CHECKBOX:
        return cast(listing.value_expression(field), String)
    # Text, numbers and single options are the text of the cell; an empty text is "no value".
    return func.nullif(listing._text(field), "")


# --- labels and filters of the groups -----------------------------------------------------------


def _next_period(key: str, bucket: str) -> str:
    start = date.fromisoformat(key if bucket != "month" else f"{key}-01")
    if bucket == "day":
        return (start + timedelta(days=1)).isoformat()
    if bucket == "week":
        return (start + timedelta(days=7)).isoformat()
    year, month = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    return date(year, month, 1).isoformat()


def _period_label(key: str, bucket: str) -> str:
    start = date.fromisoformat(key if bucket != "month" else f"{key}-01")
    if bucket == "month":
        return start.strftime("%b %Y")
    if bucket == "week":
        return f"Week of {start.isoformat()}"
    return start.isoformat()


def _condition(field: Field, key: str | None, bucket: str | None) -> list[dict[str, Any]] | None:
    """The filter that selects the records of one group."""
    name = str(field.id)
    if key is None:
        if field.type == FieldType.CREATED_BY:
            return None  # a record always has a creator
        if field.type in (FieldType.CHECKBOX, FieldType.CREATED_TIME):
            return None
        return [{"field": name, "op": "is_empty"}]
    if field.type in _DATED and bucket:
        start, end = key if bucket != "month" else f"{key}-01", _next_period(key, bucket)
        if field.type == FieldType.CREATED_TIME:
            start, end = f"{start}T00:00:00Z", f"{end}T00:00:00Z"
        return [
            {"field": name, "op": "gte", "value": start},
            {"field": name, "op": "lt", "value": end},
        ]
    if field.type in (FieldType.USER, FieldType.LINK_RECORD, FieldType.MULTI_SELECT):
        return [{"field": name, "op": "contains", "value": key}]
    if field.type == FieldType.CHECKBOX:
        return [{"field": name, "op": "eq", "value": key == "true"}]
    if field.type in listing.NUMBER_TYPES:
        return [{"field": name, "op": "eq", "value": float(key)}]
    return [{"field": name, "op": "eq", "value": key}]


async def _people_labels(
    session: AsyncSession, actor: User, keys: list[str | None]
) -> dict[str, str]:
    ids = [uuid.UUID(k) for k in keys if k is not None]
    if not ids:
        return {}
    rows = await session.execute(
        select(User.id, User.full_name).where(
            User.id.in_(ids), User.organization_id == actor.organization_id
        )
    )
    return {str(i): name for i, name in rows.all()}


async def _record_labels(
    session: AsyncSession, actor: User, field: Field, keys: list[str | None], sees_all: bool
) -> dict[str, str]:
    """The names of the records a link column points at: only records the caller may open, and
    only when the name column of that table is not hidden from them."""
    ids = [uuid.UUID(k) for k in keys if k is not None]
    target = field.config.get("table_id")
    if not ids or target is None:
        return {}
    target_id = uuid.UUID(str(target))
    title = title_field(await fields_repo.list_fields(session, table_id=target_id))
    if title is None:
        return {}
    if not is_org_admin(actor):
        overrides = await fields_repo.get_access_overrides(
            session, user_id=actor.id, table_id=target_id
        )
        if overrides.get(title.id) == FieldAccessLevel.HIDDEN:
            return {}
    query = select(Record.id, Record.data).where(
        Record.id.in_(ids), Record.deleted_at.is_(None), Record.table_id == target_id
    )
    if not sees_all:
        query = query.where(
            exists().where(RecordViewer.record_id == Record.id, RecordViewer.user_id == actor.id)
        )
    rows = await session.execute(query)
    return {str(i): str(data.get(str(title.id)) or "(untitled)") for i, data in rows.all()}


async def _labels(
    session: AsyncSession,
    actor: User,
    field: Field,
    bucket: str | None,
    keys: list[str | None],
    sees_all: bool,
) -> dict[str | None, str]:
    labels: dict[str | None, str] = {None: EMPTY}
    if field.type in _DATED and bucket:
        labels[None] = "(no date)"
        labels |= {k: _period_label(k, bucket) for k in keys if k is not None}
    elif field.type in _OPTIONS:
        names = {o["id"]: o["name"] for o in field.config.get("options", [])}
        labels |= {k: names.get(k, "(removed option)") for k in keys if k is not None}
    elif field.type in (FieldType.USER, FieldType.CREATED_BY):
        known = await _people_labels(session, actor, keys)
        labels |= {k: known.get(k, "Unknown employee") for k in keys if k is not None}
    elif field.type == FieldType.LINK_RECORD:
        labels[None] = "(no link)"
        known = await _record_labels(session, actor, field, keys, sees_all)
        labels |= {k: known.get(k, "(a task you cannot open)") for k in keys if k is not None}
    elif field.type == FieldType.CHECKBOX:
        labels |= {"true": "Checked", "false": "Unchecked"}
    else:
        labels |= {k: k for k in keys if k is not None}
    return labels


def _order(field: Field, keys: list[str | None], labels: dict[str | None, str]) -> list[str | None]:
    """Options in the order of the column, everything else by name; no value comes last."""
    present = [k for k in keys if k is not None]
    if field.type in _OPTIONS:
        position = {o["id"]: i for i, o in enumerate(field.config.get("options", []))}
        present.sort(key=lambda k: (position.get(k, len(position)), k))
    elif field.type in (FieldType.USER, FieldType.LINK_RECORD, *listing.TEXT_TYPES):
        present.sort(key=lambda k: (labels[k].lower(), k))
    elif field.type in listing.NUMBER_TYPES:
        present.sort(key=lambda k: Decimal(k))
    else:
        present.sort()
    return [*present, *([None] if None in keys else [])]


# --- the computation ----------------------------------------------------------------------------


async def compute(
    session: AsyncSession,
    actor: User,
    context: TableContext,
    visible: list[tuple[Field, FieldAccessLevel]],
    *,
    group_by: str,
    bucket: str | None,
    aggregates: list[str],
    filter_json: str | None,
    sees_all: bool,
    extra_filters: list[Any] | None = None,
) -> Groups:
    """The groups of `group_by` with a count and the asked totals. `visible` are the columns the
    caller may see: any other column is unknown here, as in the record list."""
    by_id = {str(f.id): f for f, _ in visible}
    field = by_id.get(group_by)
    if field is None:
        raise listing._unknown("group_by")
    if field.type not in GROUPABLE:
        raise _bad("group_by", "Records cannot be grouped by this kind of column.")
    chosen_bucket = _bucket_for(field, bucket)
    totals = _parse_totals(aggregates, by_id)
    conditions = [*listing.parse_filter(filter_json, by_id), *(extra_filters or [])]

    table_id = context.table.id
    base = [Record.table_id == table_id, Record.deleted_at.is_(None)]
    if not sees_all:
        base.append(
            exists().where(RecordViewer.record_id == Record.id, RecordViewer.user_id == actor.id)
        )

    # One row per (record, value): a record with two people is counted for each of them.
    source: Any = Record
    if field.type in _LISTED:
        cell = Record.data[str(field.id)]
        items = case((func.jsonb_typeof(cell) == "array", cell), else_=cast(literal("[]"), JSONB))
        elements = func.jsonb_array_elements_text(items).table_valued("value").lateral()
        source = Record.__table__.outerjoin(elements, true())
        key: Any = elements.c.value
    elif field.type == FieldType.LINK_RECORD:
        reachable = select(Record.id).where(Record.deleted_at.is_(None))
        if not sees_all:
            reachable = reachable.where(
                exists().where(
                    RecordViewer.record_id == Record.id, RecordViewer.user_id == actor.id
                )
            )
        link_target = RecordLink.target_record_id.in_(reachable.scalar_subquery())
        source = Record.__table__.outerjoin(
            RecordLink.__table__,
            and_(
                RecordLink.field_id == field.id,
                RecordLink.source_record_id == Record.id,
                link_target,
            ),
        )
        key = cast(RecordLink.target_record_id, String)
    else:
        key = _scalar_key(field, chosen_bucket)

    sums = [
        getattr(func, fn)(cast(listing._text(f), Numeric)).label(f"t{i}")
        for i, (f, fn) in enumerate(totals)
    ]
    query = (
        select(key.label("key"), func.count(Record.id.distinct()).label("n"), *sums)
        .select_from(source)
        .where(*base, *conditions)
        .group_by(key)
        .order_by(key.asc().nulls_last())
        .limit(MAX_GROUPS + 1)
    )
    rows = (await session.execute(query)).all()
    truncated = len(rows) > MAX_GROUPS
    rows = rows[:MAX_GROUPS]

    total = int(
        (
            await session.execute(
                select(func.count()).select_from(Record).where(*base, *conditions)
            )
        ).scalar_one()
    )

    keys: list[str | None] = [row.key for row in rows]
    labels = await _labels(session, actor, field, chosen_bucket, keys, sees_all)
    by_key = {row.key: row for row in rows}
    groups: list[Group] = []
    for k in _order(field, keys, labels):
        row = by_key[k]
        removed = field.type in _OPTIONS and k is not None and labels[k] == "(removed option)"
        groups.append(
            Group(
                key=k,
                label=labels[k],
                count=int(row.n),
                totals=[
                    GroupTotal(
                        field_id=f.id,
                        fn=fn,
                        value=None if row[2 + i] is None else float(row[2 + i]),
                    )
                    for i, (f, fn) in enumerate(totals)
                ],
                filter=None if removed else _condition(field, k, chosen_bucket),
            )
        )
    return Groups(
        group_by=field.id,
        bucket=chosen_bucket,
        total=total,
        truncated=truncated,
        groups=groups,
    )
