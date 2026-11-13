import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.bases import repository
from app.modules.bases.models import Table, WorkBase
from app.modules.bases.schemas import (
    BaseCreate,
    BasePublic,
    BaseUpdate,
    TableCreate,
    TableDetail,
    TablePublic,
    TableUpdate,
)
from app.modules.fields import service as fields_service
from app.modules.permissions.service import (
    require_base_role,
    require_table_read,
    require_table_role,
    require_workspace_role,
)
from app.modules.users.models import User
from app.modules.workspaces.models import WorkspaceRole

DUPLICATE_BASE = "A base with this name already exists in the workspace."
DUPLICATE_TABLE = "A table with this name already exists in the base."


def _base(base: WorkBase) -> BasePublic:
    return BasePublic(
        id=base.id, workspace_id=base.workspace_id, name=base.name, created_at=base.created_at
    )


def _table(table: Table) -> TablePublic:
    return TablePublic(
        id=table.id, base_id=table.base_id, name=table.name, created_at=table.created_at
    )


# --- bases -----------------------------------------------------------------------------------


async def list_bases(
    session: AsyncSession, actor: User, workspace_id: uuid.UUID
) -> list[BasePublic]:
    await require_workspace_role(session, actor, workspace_id, WorkspaceRole.VIEWER)
    return [_base(base) for base in await repository.list_bases(session, workspace_id=workspace_id)]


async def create_base(
    session: AsyncSession, actor: User, workspace_id: uuid.UUID, data: BaseCreate
) -> BasePublic:
    workspace, _ = await require_workspace_role(session, actor, workspace_id, WorkspaceRole.EDITOR)
    if await repository.name_taken(session, WorkBase, parent_id=workspace.id, name=data.name):
        raise ProblemError(409, DUPLICATE_BASE)
    base = WorkBase(workspace_id=workspace.id, name=data.name)
    repository.add(session, base)
    try:
        await session.flush()
    except IntegrityError:  # two requests with the same name at the same time
        raise ProblemError(409, DUPLICATE_BASE) from None
    return _base(base)


async def get_base(session: AsyncSession, actor: User, base_id: uuid.UUID) -> BasePublic:
    base, _, _ = await require_base_role(session, actor, base_id, WorkspaceRole.VIEWER)
    return _base(base)


async def rename_base(
    session: AsyncSession, actor: User, base_id: uuid.UUID, data: BaseUpdate
) -> BasePublic:
    base, _, _ = await require_base_role(session, actor, base_id, WorkspaceRole.EDITOR)
    if await repository.name_taken(
        session, WorkBase, parent_id=base.workspace_id, name=data.name, except_id=base.id
    ):
        raise ProblemError(409, DUPLICATE_BASE)
    base.name = data.name
    try:
        await session.flush()
    except IntegrityError:
        raise ProblemError(409, DUPLICATE_BASE) from None
    return _base(base)


async def delete_base(session: AsyncSession, actor: User, base_id: uuid.UUID) -> None:
    """Soft delete. Its tables and records are kept but nobody can reach them."""
    base, _, _ = await require_base_role(session, actor, base_id, WorkspaceRole.ADMIN)
    repository.soft_delete(base)
    await session.flush()


# --- tables ----------------------------------------------------------------------------------


async def list_tables(session: AsyncSession, actor: User, base_id: uuid.UUID) -> list[TablePublic]:
    base, _, _ = await require_base_role(session, actor, base_id, WorkspaceRole.VIEWER)
    return [_table(table) for table in await repository.list_tables(session, base_id=base.id)]


async def create_table(
    session: AsyncSession, actor: User, base_id: uuid.UUID, data: TableCreate
) -> TableDetail:
    base, _, role = await require_base_role(session, actor, base_id, WorkspaceRole.EDITOR)
    if await repository.name_taken(session, Table, parent_id=base.id, name=data.name):
        raise ProblemError(409, DUPLICATE_TABLE)
    table = Table(base_id=base.id, name=data.name)
    repository.add(session, table)
    try:
        await session.flush()
    except IntegrityError:
        raise ProblemError(409, DUPLICATE_TABLE) from None
    await fields_service.create_template_fields(session, table, data.template)
    fields = await fields_service.list_fields(session, actor, table.id)
    return TableDetail(**_table(table).model_dump(), fields=fields, my_role=role.value)


async def get_table(session: AsyncSession, actor: User, table_id: uuid.UUID) -> TableDetail:
    context = await require_table_read(session, actor, table_id)
    fields = await fields_service.list_fields(session, actor, table_id)
    return TableDetail(
        **_table(context.table).model_dump(),
        fields=fields,
        my_role=context.role.value if context.role else None,
    )


async def rename_table(
    session: AsyncSession, actor: User, table_id: uuid.UUID, data: TableUpdate
) -> TablePublic:
    context = await require_table_role(session, actor, table_id, WorkspaceRole.EDITOR)
    table = context.table
    if await repository.name_taken(
        session, Table, parent_id=table.base_id, name=data.name, except_id=table.id
    ):
        raise ProblemError(409, DUPLICATE_TABLE)
    table.name = data.name
    try:
        await session.flush()
    except IntegrityError:
        raise ProblemError(409, DUPLICATE_TABLE) from None
    return _table(table)


async def delete_table(session: AsyncSession, actor: User, table_id: uuid.UUID) -> None:
    context = await require_table_role(session, actor, table_id, WorkspaceRole.ADMIN)
    repository.soft_delete(context.table)
    await session.flush()
