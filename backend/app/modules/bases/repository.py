import uuid
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.bases.models import Table, WorkBase
from app.modules.workspaces.models import Workspace


def live_conditions(organization_id: uuid.UUID) -> tuple[ColumnElement[bool], ...]:
    """The table, its base and its workspace all still exist, in this organization.

    For a query that already joins Table, WorkBase and Workspace.
    """
    return (
        Table.deleted_at.is_(None),
        WorkBase.deleted_at.is_(None),
        Workspace.organization_id == organization_id,
        Workspace.deleted_at.is_(None),
    )


async def get_base(
    session: AsyncSession, *, organization_id: uuid.UUID, base_id: uuid.UUID
) -> tuple[WorkBase, Workspace] | None:
    """A live base whose workspace is live and belongs to the organization."""
    result = await session.execute(
        select(WorkBase, Workspace)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .where(
            WorkBase.id == base_id,
            WorkBase.deleted_at.is_(None),
            Workspace.organization_id == organization_id,
            Workspace.deleted_at.is_(None),
        )
    )
    row = result.first()
    return (row[0], row[1]) if row else None


async def get_table(
    session: AsyncSession, *, organization_id: uuid.UUID, table_id: uuid.UUID
) -> tuple[Table, WorkBase, Workspace] | None:
    """A live table whose base and workspace are live and belong to the organization."""
    result = await session.execute(
        select(Table, WorkBase, Workspace)
        .join(WorkBase, WorkBase.id == Table.base_id)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .where(
            Table.id == table_id,
            *live_conditions(organization_id),
        )
    )
    row = result.first()
    return (row[0], row[1], row[2]) if row else None


async def list_bases(session: AsyncSession, *, workspace_id: uuid.UUID) -> list[WorkBase]:
    result = await session.execute(
        select(WorkBase)
        .where(WorkBase.workspace_id == workspace_id, WorkBase.deleted_at.is_(None))
        .order_by(WorkBase.name, WorkBase.id)
    )
    return list(result.scalars())


async def list_tables(session: AsyncSession, *, base_id: uuid.UUID) -> list[Table]:
    result = await session.execute(
        select(Table)
        .where(Table.base_id == base_id, Table.deleted_at.is_(None))
        .order_by(Table.name, Table.id)
    )
    return list(result.scalars())


async def name_taken(
    session: AsyncSession,
    model: type[WorkBase] | type[Table],
    *,
    parent_id: uuid.UUID,
    name: str,
    except_id: uuid.UUID | None = None,
) -> bool:
    """Is there already a live base (in the workspace) or table (in the base) with this name?"""
    from sqlalchemy import func

    parent_column = WorkBase.workspace_id if model is WorkBase else Table.base_id
    query = select(model.id).where(
        parent_column == parent_id,
        func.lower(model.name) == name.lower(),
        model.deleted_at.is_(None),
    )
    if except_id is not None:
        query = query.where(model.id != except_id)
    return (await session.execute(query.limit(1))).first() is not None


def add(session: AsyncSession, item: WorkBase | Table) -> None:
    session.add(item)


def soft_delete(item: WorkBase | Table) -> None:
    item.deleted_at = datetime.now(UTC)


__all__ = ["IntegrityError"]
