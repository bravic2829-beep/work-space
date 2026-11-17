"""The trash: list what I deleted, restore it, empty what is older than 30 days.

Whoever deletes a record restores it (an organization admin sees and restores everybody's), and
it stays 30 days
(docs/usecases.md 3.4). After that a scheduled job (`python -m app.cli purge-trash`) removes it
for good; links, viewers, comments and notifications of the record go with it.
"""

import uuid
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel
from sqlalchemy import delete, select, true, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.core.pagination import Page, check_limit, parse_time_cursor, time_cursor
from app.modules.bases.models import Table, WorkBase
from app.modules.fields import repository as fields_repo
from app.modules.fields.models import FieldAccessLevel
from app.modules.fields.titles import title_field, title_of
from app.modules.permissions.service import is_org_admin, load_table_context
from app.modules.records import service
from app.modules.records.models import Record
from app.modules.records.schemas import RecordPublic
from app.modules.users.models import User
from app.modules.workspaces.models import Workspace

TRASH_DAYS = 30


class TrashItem(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    table_name: str
    name: str | None
    deleted_at: datetime
    purge_at: datetime


def _alive_in(organization_id: uuid.UUID):  # type: ignore[no-untyped-def]
    """Conditions: the table, base and workspace of the record still exist."""
    return (
        Table.deleted_at.is_(None),
        WorkBase.deleted_at.is_(None),
        Workspace.organization_id == organization_id,
        Workspace.deleted_at.is_(None),
    )


async def list_trash(
    session: AsyncSession, actor: User, *, limit: int, cursor: str | None
) -> Page[TrashItem]:
    """The records this person deleted (an admin: everybody's), newest deletion first."""
    check_limit(limit)
    now = datetime.now(UTC)
    query = (
        select(Record, Table)
        .join(Table, Table.id == Record.table_id)
        .join(WorkBase, WorkBase.id == Table.base_id)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .where(
            true() if is_org_admin(actor) else Record.deleted_by == actor.id,
            Record.deleted_at.is_not(None),
            Record.deleted_at >= now - timedelta(days=TRASH_DAYS),
            *_alive_in(actor.organization_id),
        )
        .order_by(Record.deleted_at.desc(), Record.id.desc())
        .limit(limit + 1)
    )
    after = parse_time_cursor(cursor)
    if after is not None:
        query = query.where(tuple_(Record.deleted_at, Record.id) < tuple_(*after))
    rows = [(row[0], row[1]) for row in (await session.execute(query)).all()]
    more = len(rows) > limit
    rows = rows[:limit]

    items: list[TrashItem] = []
    shown: dict[uuid.UUID, bool] = {}
    fields_by_table: dict[uuid.UUID, list] = {}  # type: ignore[type-arg]
    for record, table in rows:
        if table.id not in fields_by_table:
            fields = await fields_repo.list_fields(session, table_id=table.id)
            fields_by_table[table.id] = fields
            column = title_field(fields)
            overrides = await fields_repo.get_access_overrides(
                session, user_id=actor.id, table_id=table.id
            )
            shown[table.id] = column is None or overrides.get(column.id) != FieldAccessLevel.HIDDEN
        assert record.deleted_at is not None
        items.append(
            TrashItem(
                id=record.id,
                table_id=table.id,
                table_name=table.name,
                name=title_of(fields_by_table[table.id], record.data) if shown[table.id] else None,
                deleted_at=record.deleted_at,
                purge_at=record.deleted_at + timedelta(days=TRASH_DAYS),
            )
        )
    next_cursor = None
    if more:
        last = rows[-1][0]
        assert last.deleted_at is not None
        next_cursor = time_cursor(last.deleted_at, last.id)
    return Page[TrashItem](items=items, next_cursor=next_cursor)


async def restore_record(
    session: AsyncSession, actor: User, record_id: uuid.UUID
) -> tuple[Record, RecordPublic]:
    """Take a record out of the trash. Only the person who deleted it can, within 30 days."""
    record = (
        await session.execute(
            select(Record)
            .join(Table, Table.id == Record.table_id)
            .join(WorkBase, WorkBase.id == Table.base_id)
            .join(Workspace, Workspace.id == WorkBase.workspace_id)
            .where(
                Record.id == record_id,
                Record.deleted_at.is_not(None),
                *_alive_in(actor.organization_id),
            )
            .with_for_update(of=Record)
        )
    ).scalar_one_or_none()
    if record is None or record.deleted_at is None:
        raise ProblemError(404, "The record is not in the trash.")
    if record.deleted_at < datetime.now(UTC) - timedelta(days=TRASH_DAYS):
        raise ProblemError(404, "The record is not in the trash.")
    if record.deleted_by != actor.id and not is_org_admin(actor):
        raise ProblemError(
            403, "Only the person who deleted a record, or an admin, can restore it."
        )

    record.deleted_at = None
    record.deleted_by = None
    record.version = record.version + 1
    record.updated_at = datetime.now(UTC)
    await session.flush()
    await session.refresh(record)

    context = await load_table_context(session, actor, record.table_id)
    fields = await service._fields_with_access(session, actor, context, is_creator=True)
    rendered = await service.render(session, actor, context, [record], service._visible(fields))
    return record, rendered[0]


async def delete_forever(session: AsyncSession, actor: User, record_id: uuid.UUID) -> None:
    """Remove a record that is in the trash for good. Same people as restore: whoever deleted
    it, or an organization admin. Links, viewers, comments and notifications go with it."""
    record = (
        await session.execute(
            select(Record)
            .join(Table, Table.id == Record.table_id)
            .join(WorkBase, WorkBase.id == Table.base_id)
            .join(Workspace, Workspace.id == WorkBase.workspace_id)
            .where(
                Record.id == record_id,
                Record.deleted_at.is_not(None),
                Record.deleted_at >= datetime.now(UTC) - timedelta(days=TRASH_DAYS),
                *_alive_in(actor.organization_id),
            )
            .with_for_update(of=Record)
        )
    ).scalar_one_or_none()
    if record is None:
        raise ProblemError(404, "The record is not in the trash.")
    if record.deleted_by != actor.id and not is_org_admin(actor):
        raise ProblemError(
            403, "Only the person who deleted a record, or an admin, can remove it for good."
        )
    await session.delete(record)
    await session.flush()


async def purge_expired(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Remove for good every record that has been in the trash for more than 30 days."""
    limit = (now or datetime.now(UTC)) - timedelta(days=TRASH_DAYS)
    result = await session.execute(
        delete(Record).where(Record.deleted_at.is_not(None), Record.deleted_at < limit)
    )
    return int(result.rowcount or 0)  # type: ignore[attr-defined]
