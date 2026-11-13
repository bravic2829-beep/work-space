"""The "Assigned to me" and "Today's tasks" views (UC-K9): tasks of many tables in one list.

A task is mine when I am named in the assignee column of its table. Only tasks I may open are
listed (I am a workspace member, or the record lists me as a viewer), and a column that is
hidden from me is left out, exactly as in the table itself.
"""

import uuid
from datetime import UTC, date, datetime
from typing import Any, Literal

from sqlalchemy import Text, cast, exists, false, or_, select, true, tuple_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import ProblemError
from app.core.pagination import MAX_PAGE_SIZE, Page, decode_cursor, encode_cursor
from app.modules.bases.models import Table, WorkBase
from app.modules.fields import repository as fields_repo
from app.modules.fields.models import Field, FieldAccessLevel, FieldSemantic
from app.modules.fields.titles import title_field, title_of
from app.modules.my_tasks.schemas import MyTask, TaskStatus
from app.modules.permissions.service import is_org_admin
from app.modules.records.models import Record, RecordViewer
from app.modules.users.models import User
from app.modules.workspaces.models import Workspace, WorkspaceMember

Scope = Literal["assigned", "today"]


def _parse_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    try:
        stamp, raw_id = decode_cursor(cursor).split("|")
        parsed = datetime.fromisoformat(stamp)
        if parsed.tzinfo is None:
            raise ValueError("no time zone")
        return parsed, uuid.UUID(raw_id)
    except ValueError:
        raise ProblemError(422, "The cursor is not valid.") from None


def _day(value: str | None) -> str:
    """The day for "today": the client sends its own date, because the server cannot know it."""
    if value is None:
        return datetime.now(UTC).date().isoformat()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ProblemError(422, "The date must look like 2026-11-13.") from None


async def list_my_tasks(
    session: AsyncSession,
    actor: User,
    *,
    scope: Scope,
    day: str | None,
    limit: int,
    cursor: str | None,
) -> Page[MyTask]:
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise ProblemError(422, f"The limit must be from 1 to {MAX_PAGE_SIZE}.")
    today = _day(day)

    assignee = aliased(Field)
    named = Record.data.op("->", return_type=JSONB)(cast(assignee.id, Text)).contains(
        [str(actor.id)]
    )
    can_open = or_(
        exists().where(RecordViewer.record_id == Record.id, RecordViewer.user_id == actor.id),
        exists().where(
            WorkspaceMember.workspace_id == Workspace.id, WorkspaceMember.user_id == actor.id
        ),
        true() if is_org_admin(actor) else false(),
    )
    query = (
        select(Record, Table)
        .join(Table, Table.id == Record.table_id)
        .join(WorkBase, WorkBase.id == Table.base_id)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .join(
            assignee,
            (assignee.table_id == Record.table_id)
            & (assignee.semantic == FieldSemantic.ASSIGNEE)
            & assignee.deleted_at.is_(None),
        )
        .where(
            Record.deleted_at.is_(None),
            Table.deleted_at.is_(None),
            WorkBase.deleted_at.is_(None),
            Workspace.deleted_at.is_(None),
            Workspace.organization_id == actor.organization_id,
            named,
            can_open,
        )
        .order_by(Record.created_at.desc(), Record.id.desc())
        .limit(limit + 1)
    )
    if scope == "today":
        due = aliased(Field)
        query = query.join(
            due,
            (due.table_id == Record.table_id)
            & (due.semantic == FieldSemantic.DUE_DATE)
            & due.deleted_at.is_(None),
        ).where(
            Record.data.op("->>", return_type=Text)(cast(due.id, Text)).startswith(
                today, autoescape=True
            )
        )
    after = _parse_cursor(cursor)
    if after is not None:
        query = query.where(tuple_(Record.created_at, Record.id) < tuple_(*after))

    rows = [(row[0], row[1]) for row in (await session.execute(query)).all()]
    more = len(rows) > limit
    rows = rows[:limit]

    fields_cache: dict[uuid.UUID, tuple[list[Field], dict[uuid.UUID, FieldAccessLevel]]] = {}
    items: list[MyTask] = []
    for record, table in rows:
        if table.id not in fields_cache:
            fields_cache[table.id] = (
                await fields_repo.list_fields(session, table_id=table.id),
                await fields_repo.get_access_overrides(
                    session, user_id=actor.id, table_id=table.id
                ),
            )
        fields, overrides = fields_cache[table.id]
        items.append(_item(record, table, fields, overrides, hide_nothing=is_org_admin(actor)))

    next_cursor = None
    if more:
        last = rows[-1][0]
        next_cursor = encode_cursor(f"{last.created_at.astimezone(UTC).isoformat()}|{last.id}")
    return Page[MyTask](items=items, next_cursor=next_cursor)


def _item(
    record: Record,
    table: Table,
    fields: list[Field],
    overrides: dict[uuid.UUID, FieldAccessLevel],
    *,
    hide_nothing: bool,
) -> MyTask:
    def visible(column: Field | None) -> bool:
        if column is None:
            return False
        return hide_nothing or overrides.get(column.id) != FieldAccessLevel.HIDDEN

    due = next((f for f in fields if f.semantic == FieldSemantic.DUE_DATE), None)
    status = next((f for f in fields if f.semantic == FieldSemantic.STATUS), None)
    title = title_field(fields)

    due_value: Any = record.data.get(str(due.id)) if due and visible(due) else None
    status_value: TaskStatus | None = None
    if status is not None and visible(status):
        chosen = record.data.get(str(status.id))
        for option in status.config.get("options", []):
            if option["id"] == chosen:
                status_value = TaskStatus(name=option["name"], kind=option["kind"])
    return MyTask(
        id=record.id,
        table_id=table.id,
        table_name=table.name,
        name=title_of(fields, record.data) if visible(title) else None,
        due_date=str(due_value) if due_value is not None else None,
        status=status_value,
        created_at=record.created_at,
    )
