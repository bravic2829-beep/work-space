import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.bases.models import Table, WorkBase
from app.modules.fields.models import Field, FieldAccess, FieldAccessLevel, FieldSemantic
from app.modules.workspaces.models import Workspace

MAX_FIELDS_PER_TABLE = 200


async def get_field(
    session: AsyncSession, *, organization_id: uuid.UUID, field_id: uuid.UUID
) -> Field | None:
    """A live field of a live table of the organization."""
    result = await session.execute(
        select(Field)
        .join(Table, Table.id == Field.table_id)
        .join(WorkBase, WorkBase.id == Table.base_id)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .where(
            Field.id == field_id,
            Field.deleted_at.is_(None),
            Table.deleted_at.is_(None),
            WorkBase.deleted_at.is_(None),
            Workspace.organization_id == organization_id,
            Workspace.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def list_fields(session: AsyncSession, *, table_id: uuid.UUID) -> list[Field]:
    result = await session.execute(
        select(Field)
        .where(Field.table_id == table_id, Field.deleted_at.is_(None))
        .order_by(Field.position, Field.created_at, Field.id)
    )
    return list(result.scalars())


async def count_fields(session: AsyncSession, *, table_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Field)
        .where(Field.table_id == table_id, Field.deleted_at.is_(None))
    )
    return int(result.scalar_one())


async def next_position(session: AsyncSession, *, table_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.coalesce(func.max(Field.position), -1) + 1).where(
            Field.table_id == table_id, Field.deleted_at.is_(None)
        )
    )
    return int(result.scalar_one())


async def name_taken(
    session: AsyncSession, *, table_id: uuid.UUID, name: str, except_id: uuid.UUID | None = None
) -> bool:
    query = select(Field.id).where(
        Field.table_id == table_id,
        func.lower(Field.name) == name.lower(),
        Field.deleted_at.is_(None),
    )
    if except_id is not None:
        query = query.where(Field.id != except_id)
    return (await session.execute(query.limit(1))).first() is not None


async def semantic_taken(
    session: AsyncSession, *, table_id: uuid.UUID, semantic: FieldSemantic
) -> bool:
    result = await session.execute(
        select(Field.id)
        .where(Field.table_id == table_id, Field.semantic == semantic, Field.deleted_at.is_(None))
        .limit(1)
    )
    return result.first() is not None


async def next_auto_number(session: AsyncSession, *, field_id: uuid.UUID, count: int = 1) -> int:
    """Reserve `count` numbers of an auto_number field. Returns the first one.

    The UPDATE takes a row lock, so two records made at the same time never get the same number.
    """
    result = await session.execute(
        update(Field)
        .where(Field.id == field_id)
        .values(counter=Field.counter + count)
        .returning(Field.counter)
    )
    return int(result.scalar_one()) - count + 1


async def get_access_overrides(
    session: AsyncSession, *, user_id: uuid.UUID, table_id: uuid.UUID
) -> dict[uuid.UUID, FieldAccessLevel]:
    result = await session.execute(
        select(FieldAccess.field_id, FieldAccess.access)
        .join(Field, Field.id == FieldAccess.field_id)
        .where(FieldAccess.user_id == user_id, Field.table_id == table_id)
    )
    return {row[0]: row[1] for row in result.all()}


async def list_access(session: AsyncSession, *, field_id: uuid.UUID) -> list[FieldAccess]:
    result = await session.execute(
        select(FieldAccess).where(FieldAccess.field_id == field_id).order_by(FieldAccess.user_id)
    )
    return list(result.scalars())


async def list_access_for_table(session: AsyncSession, *, table_id: uuid.UUID) -> list[FieldAccess]:
    """Every column rule of the table (of its live columns), grouped by person by the caller."""
    result = await session.execute(
        select(FieldAccess)
        .join(Field, Field.id == FieldAccess.field_id)
        .where(Field.table_id == table_id, Field.deleted_at.is_(None))
        .order_by(FieldAccess.user_id, Field.position, Field.id)
    )
    return list(result.scalars())


def soft_delete(field: Field) -> None:
    field.deleted_at = datetime.now(UTC)
