"""Creating, reading, changing and deleting records.

Every way to write a record goes through here, because `record_viewers` and `record_links` must
change in the same transaction as `records.data` (ADR 0003).
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.core.pagination import MAX_PAGE_SIZE, Page
from app.modules.fields import repository as fields_repo
from app.modules.fields.access import column_access
from app.modules.fields.models import Field, FieldAccessLevel, FieldSemantic, FieldType
from app.modules.fields.types import (
    COMPUTED_TYPES,
    DATE_FILL_CREATED,
    STORED_IN_DATA,
    normalize_value,
)
from app.modules.notifications import service as notifications
from app.modules.permissions.service import (
    TableContext,
    can_view_record,
    is_org_admin,
    load_table_context,
    require_table_read,
)
from app.modules.records import links, listing, repository, subtasks, visibility
from app.modules.records.models import Record
from app.modules.records.schemas import RecordPublic
from app.modules.users.models import User

FORBIDDEN = "You do not have permission to do this."


@dataclass
class Changes:
    """What a request wants to do to a record, once checked."""

    data: dict[str, Any] = field(default_factory=dict)  # field id -> clean value
    cleared: set[str] = field(default_factory=set)  # field ids set to empty
    links: dict[uuid.UUID, list[uuid.UUID]] = field(default_factory=dict)  # link field -> targets
    touches_viewers: bool = False


def sees_everything(user: User, context: TableContext) -> bool:
    return context.role is not None or is_org_admin(user)


def parse_if_match(value: str | None) -> int:
    """The version in an If-Match header (`"3"`, `W/"3"` or `3`)."""
    if value is None or not value.strip():
        raise ProblemError(428, "Send the version you are changing in the If-Match header.")
    cleaned = value.strip()
    if cleaned.startswith("W/"):
        cleaned = cleaned[2:]
    cleaned = cleaned.strip('"')
    if not cleaned.isdigit():
        raise ProblemError(400, "If-Match must be the ETag of the record.")
    return int(cleaned)


def etag(record: Record) -> str:
    return f'"{record.version}"'


# --- output ----------------------------------------------------------------------------------


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


async def render(
    session: AsyncSession,
    actor: User,
    context: TableContext,
    records: list[Record],
    visible: list[tuple[Field, FieldAccessLevel]],
) -> list[RecordPublic]:
    """Records as the caller may see them: only visible columns, links to visible records."""
    link_fields = [f.id for f, _ in visible if f.type == FieldType.LINK_RECORD]
    targets = await links.load_targets(
        session,
        [r.id for r in records],
        link_fields,
        actor=actor,
        sees_all=sees_everything(actor, context),
    )
    result: list[RecordPublic] = []
    for record in records:
        data: dict[str, Any] = {}
        for column, _ in visible:
            key = str(column.id)
            if column.type in STORED_IN_DATA:
                if key in record.data:
                    data[key] = record.data[key]
            elif column.type == FieldType.CREATED_BY:
                data[key] = str(record.created_by)
            elif column.type == FieldType.CREATED_TIME:
                data[key] = _iso(record.created_at)
            elif column.type == FieldType.LINK_RECORD:
                data[key] = [str(t) for t in targets.get((record.id, column.id), [])]
        result.append(
            RecordPublic(
                id=record.id,
                table_id=record.table_id,
                data=data,
                created_by=record.created_by,
                created_at=record.created_at,
                updated_at=record.updated_at,
                version=record.version,
            )
        )
    return result


async def _fields_with_access(
    session: AsyncSession, actor: User, context: TableContext, *, is_creator: bool = False
) -> list[tuple[Field, FieldAccessLevel]]:
    fields = await fields_repo.list_fields(session, table_id=context.table.id)
    access = await column_access(session, actor, context, fields, is_creator=is_creator)
    return [(f, access[f.id]) for f in fields]


def _visible(
    fields: list[tuple[Field, FieldAccessLevel]],
) -> list[tuple[Field, FieldAccessLevel]]:
    return [(f, level) for f, level in fields if level != FieldAccessLevel.HIDDEN]


# --- checking what a request wants to write ---------------------------------------------------


async def _check_changes(
    session: AsyncSession,
    actor: User,
    context: TableContext,
    fields: list[tuple[Field, FieldAccessLevel]],
    incoming: dict[str, Any],
    *,
    record: Record | None,
) -> Changes:
    by_key = {str(f.id): (f, level) for f, level in fields if level != FieldAccessLevel.HIDDEN}
    changes = Changes()
    errors: list[dict[str, str]] = []

    # A hidden column is "unknown" to this person. A known column they cannot edit is a 403.
    for key in incoming:
        if key not in by_key:
            errors.append({"field": key, "message": "Unknown field."})
    if errors:
        raise ProblemError(422, "One or more values are invalid.", errors=errors)
    for key in incoming:
        column, level = by_key[key]
        if level != FieldAccessLevel.EDIT and column.type not in COMPUTED_TYPES:
            raise ProblemError(403, f"You cannot edit the column '{column.name}'.")

    user_ids: list[uuid.UUID] = []
    for key, value in incoming.items():
        column, _ = by_key[key]
        if column.type in COMPUTED_TYPES:
            errors.append({"field": key, "message": "Set by the system and cannot be edited."})
            continue
        if value is None:
            if column.is_required:
                errors.append({"field": key, "message": "This field is required."})
                continue
            changes.cleared.add(key)
            if column.type == FieldType.LINK_RECORD:
                changes.links[column.id] = []
            if column.type == FieldType.USER and column.grants_view:
                changes.touches_viewers = True
            continue
        try:
            clean = normalize_value(column.type, column.config, value)
        except ValueError as exc:
            errors.append({"field": key, "message": str(exc)})
            continue
        if column.type == FieldType.LINK_RECORD:
            changes.links[column.id] = [uuid.UUID(item) for item in clean]
            continue
        changes.data[key] = clean
        if column.type == FieldType.USER:
            user_ids.extend(uuid.UUID(item) for item in clean)
            if column.grants_view:
                changes.touches_viewers = True

    if user_ids:
        known = await repository.active_user_ids(
            session, organization_id=actor.organization_id, ids=list(set(user_ids))
        )
        if not set(user_ids) <= known:
            # Which id is wrong is not named: it would confirm which ids exist elsewhere.
            for key, (column, _) in by_key.items():
                if key in changes.data and column.type == FieldType.USER:
                    if not {uuid.UUID(i) for i in changes.data[key]} <= known:
                        errors.append(
                            {"field": key, "message": "An employee does not exist or is disabled."}
                        )
    if errors:
        raise ProblemError(422, "One or more values are invalid.", errors=errors)

    sees_all = sees_everything(actor, context)
    for field_id, targets in changes.links.items():
        column = next(f for f, _ in fields if f.id == field_id)
        try:
            await links.check_targets(session, actor, column, record, targets, sees_all=sees_all)
        except ProblemError as exc:
            errors.append({"field": str(field_id), "message": exc.detail or "Invalid links."})
    if errors:
        raise ProblemError(422, "One or more values are invalid.", errors=errors)
    return changes


# --- create ----------------------------------------------------------------------------------


async def create_record(
    session: AsyncSession, actor: User, table_id: uuid.UUID, incoming: dict[str, Any]
) -> tuple[Record, RecordPublic]:
    context = await load_table_context(session, actor, table_id)
    if not context.can_edit:
        # Not an editor: the only way in is a subtask of a task assigned to a department head.
        await subtasks.require_subtask_right(session, actor, table_id, incoming)
    fields = await _fields_with_access(session, actor, context, is_creator=True)
    changes = await _check_changes(session, actor, context, fields, incoming, record=None)

    errors = [
        {"field": str(f.id), "message": "This field is required."}
        for f, level in fields
        if f.is_required
        and level == FieldAccessLevel.EDIT
        and f.type in STORED_IN_DATA
        and str(f.id) not in changes.data
    ]
    if errors:
        raise ProblemError(422, "One or more values are invalid.", errors=errors)

    data = dict(changes.data)
    for column, _ in fields:
        if column.type == FieldType.AUTO_NUMBER:
            data[str(column.id)] = await fields_repo.next_auto_number(session, field_id=column.id)
    _fill_created_dates(fields, data)

    record = Record(table_id=table_id, data=data, created_by=actor.id)
    session.add(record)
    await session.flush()
    await visibility.rebuild_record(session, record, [f for f, _ in fields])
    await _write_links(session, fields, record, changes)
    await _notify_newassignees(session, actor, record, fields, before=set(), after=record.data)
    await session.refresh(record)
    rendered = await render(session, actor, context, [record], _visible(fields))
    return record, rendered[0]


def _fill_created_dates(fields: list[tuple[Field, FieldAccessLevel]], data: dict[str, Any]) -> None:
    """Date columns set to "created" get the moment of creation when nobody gave a value.

    The web page sends the date of the person's own clock, so a person in Vietnam at 22:00 gets
    their own day. This is the fallback for every other way of making a record: a date without a
    time is then the day in UTC, a date with a time is exact.
    """
    now = datetime.now(UTC)
    for column, _ in fields:
        if column.type != FieldType.DATE or column.config.get("fill") != DATE_FILL_CREATED:
            continue
        if str(column.id) in data:
            continue
        data[str(column.id)] = (
            now.strftime("%Y-%m-%dT%H:%M:%SZ")
            if column.config.get("include_time")
            else now.date().isoformat()
        )


async def _notify_newassignees(
    session: AsyncSession,
    actor: User,
    record: Record,
    fields: list[tuple[Field, FieldAccessLevel]],
    *,
    before: set[uuid.UUID],
    after: dict[str, Any],
) -> None:
    """Notify the people who are newly named in the assignee column (UC-K1, UC-K7)."""
    column = next((f for f, _ in fields if f.semantic == FieldSemantic.ASSIGNEE), None)
    if column is None:
        return
    named = {uuid.UUID(str(item)) for item in after.get(str(column.id), [])}
    await notifications.notify_task_assigned(
        session, actor, record, [f for f, _ in fields], named - before
    )


def assignees(record: Record, fields: list[tuple[Field, FieldAccessLevel]]) -> set[uuid.UUID]:
    column = next((f for f, _ in fields if f.semantic == FieldSemantic.ASSIGNEE), None)
    if column is None:
        return set()
    return {uuid.UUID(str(item)) for item in record.data.get(str(column.id), [])}


async def _write_links(
    session: AsyncSession,
    fields: list[tuple[Field, FieldAccessLevel]],
    record: Record,
    changes: Changes,
) -> None:
    by_id = {f.id: f for f, _ in fields}
    for field_id, targets in changes.links.items():
        column = by_id[field_id]
        await links.check_no_cycle(session, column, record.id, targets)
        await links.set_targets(session, column, record.id, targets)


# --- read ------------------------------------------------------------------------------------


async def _load(
    session: AsyncSession, actor: User, record_id: uuid.UUID, *, for_update: bool = False
) -> tuple[Record, TableContext]:
    """A record the person may see. 404 when it does not exist, 403 when they may not see it."""
    record = await repository.get_record(
        session, organization_id=actor.organization_id, record_id=record_id, for_update=for_update
    )
    if record is None:
        raise ProblemError(404, "The record does not exist.")
    context = await load_table_context(session, actor, record.table_id)
    if not await can_view_record(session, actor, context, record):
        raise ProblemError(403, FORBIDDEN)
    return record, context


async def get_record(
    session: AsyncSession, actor: User, record_id: uuid.UUID
) -> tuple[Record, RecordPublic]:
    record, context = await _load(session, actor, record_id)
    fields = await _fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id
    )
    rendered = await render(session, actor, context, [record], _visible(fields))
    return record, rendered[0]


async def list_records(
    session: AsyncSession,
    actor: User,
    table_id: uuid.UUID,
    *,
    limit: int,
    cursor: str | None,
    sort: list[str],
    filter_json: str | None,
) -> Page[RecordPublic]:
    """A page of the records the person may see, with only the columns they may see."""
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise ProblemError(422, f"The limit must be from 1 to {MAX_PAGE_SIZE}.")
    context = await require_table_read(session, actor, table_id)
    visible = _visible(await _fields_with_access(session, actor, context))
    # Filtering or sorting by a hidden column would reveal its values, so only visible columns
    # are known here.
    by_id = {str(f.id): f for f, _ in visible}

    built = listing.build_query(
        table_id=table_id,
        viewer_id=None if sees_everything(actor, context) else actor.id,
        filters=listing.parse_filter(filter_json, by_id),
        sort=listing.parse_sort(sort, by_id),
        cursor=cursor,
        limit=limit,
    )
    rows = (await session.execute(built.query)).all()
    more = len(rows) > limit
    rows = rows[:limit]
    rendered = await render(session, actor, context, [row[0] for row in rows], visible)
    return Page[RecordPublic](
        items=rendered, next_cursor=listing.cursor_for(built, rows[-1]) if more else None
    )


# --- update ----------------------------------------------------------------------------------


async def update_record(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    incoming: dict[str, Any],
    if_match: str | None,
) -> tuple[Record, RecordPublic]:
    record, context = await _load(session, actor, record_id, for_update=True)
    fields = await _fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id
    )
    expected = parse_if_match(if_match)
    changes = await _check_changes(session, actor, context, fields, incoming, record=record)
    if expected != record.version:
        raise ProblemError(412, "The record was changed by somebody else. Reload it and try again.")

    new_data = {k: v for k, v in record.data.items() if k not in changes.cleared}
    new_data.update(changes.data)

    changed_links = {}
    for field_id, targets in changes.links.items():
        column = next(f for f, _ in fields if f.id == field_id)
        if set(targets) != set(await links.current_targets(session, column, record.id)):
            changed_links[field_id] = targets
    changes.links = changed_links

    if new_data != record.data or changed_links:
        assigned_before = assignees(record, fields)
        record.data = new_data
        record.version = record.version + 1
        record.updated_at = datetime.now(UTC)
        await session.flush()
        if changes.touches_viewers:
            await visibility.rebuild_record(session, record, [f for f, _ in fields])
        await _write_links(session, fields, record, changes)
        await _notify_newassignees(
            session, actor, record, fields, before=assigned_before, after=record.data
        )
        await session.refresh(record)
    rendered = await render(session, actor, context, [record], _visible(fields))
    return record, rendered[0]


# --- delete ----------------------------------------------------------------------------------


async def delete_record(session: AsyncSession, actor: User, record_id: uuid.UUID) -> None:
    """Delete a record for good. Only the person who created it may do that.

    There is no trash step: the record, its links, viewers, comments and notifications go in
    one statement (the database cascades). The subtasks of the record stay, without a parent.
    Records that were put in the trash before this change can still be restored (trash.py).
    """
    record, _ = await _load(session, actor, record_id, for_update=True)
    if record.created_by != actor.id:
        raise ProblemError(403, "Only the person who created a record can delete it.")
    await session.execute(delete(Record).where(Record.id == record.id))
    await session.flush()
