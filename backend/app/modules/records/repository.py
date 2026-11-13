import uuid

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.bases.models import Table, WorkBase
from app.modules.fields.models import Field
from app.modules.records.models import Record
from app.modules.users.models import User, UserStatus
from app.modules.workspaces.models import Workspace


async def count_live(session: AsyncSession, *, table_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Record)
        .where(Record.table_id == table_id, Record.deleted_at.is_(None))
    )
    return int(result.scalar_one())


async def count_missing_value(session: AsyncSession, *, field: Field) -> int:
    """Live records of the table that have no value in the field."""
    result = await session.execute(
        select(func.count())
        .select_from(Record)
        .where(
            Record.table_id == field.table_id,
            Record.deleted_at.is_(None),
            ~Record.data.has_key(str(field.id)),
        )
    )
    return int(result.scalar_one())


async def backfill_auto_number(session: AsyncSession, *, field: Field) -> None:
    """Number the existing records of the table 1, 2, 3... in the order they were made."""
    await session.execute(
        text(
            "UPDATE records r SET data = jsonb_set(r.data, ARRAY[:fid], to_jsonb(n.rn)) "
            "FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn "
            "      FROM records WHERE table_id = :tid AND deleted_at IS NULL) n "
            "WHERE r.id = n.id"
        ),
        {"fid": str(field.id), "tid": field.table_id},
    )
    field.counter = await count_live(session, table_id=field.table_id)
    await session.flush()


async def get_record(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    record_id: uuid.UUID,
    for_update: bool = False,
) -> Record | None:
    """A live record of a live table of the organization. `for_update` locks the row."""
    query = (
        select(Record)
        .join(Table, Table.id == Record.table_id)
        .join(WorkBase, WorkBase.id == Table.base_id)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .where(
            Record.id == record_id,
            Record.deleted_at.is_(None),
            Table.deleted_at.is_(None),
            WorkBase.deleted_at.is_(None),
            Workspace.organization_id == organization_id,
            Workspace.deleted_at.is_(None),
        )
    )
    if for_update:
        query = query.with_for_update(of=Record)
    return (await session.execute(query)).scalar_one_or_none()


async def active_user_ids(
    session: AsyncSession, *, organization_id: uuid.UUID, ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of these ids are active employees of the organization."""
    if not ids:
        return set()
    result = await session.execute(
        select(User.id).where(
            User.id.in_(ids),
            User.organization_id == organization_id,
            User.status == UserStatus.ACTIVE,
        )
    )
    return set(result.scalars())
