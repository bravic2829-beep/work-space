import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.bases import service
from app.modules.bases.schemas import (
    BaseCreate,
    BasePublic,
    BaseUpdate,
    TableCreate,
    TableDetail,
    TablePublic,
    TableUpdate,
)
from app.modules.users.models import User

router = APIRouter(tags=["bases and tables"])


@router.get("/workspaces/{workspace_id}/bases", response_model=list[BasePublic])
async def list_bases(
    workspace_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BasePublic]:
    return await service.list_bases(session, actor, workspace_id)


@router.post("/workspaces/{workspace_id}/bases", status_code=201, response_model=BasePublic)
async def create_base(
    workspace_id: uuid.UUID,
    body: BaseCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BasePublic:
    base = await service.create_base(session, actor, workspace_id, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/bases/{base.id}"
    return base


@router.get("/bases/{base_id}", response_model=BasePublic)
async def get_base(
    base_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BasePublic:
    return await service.get_base(session, actor, base_id)


@router.patch("/bases/{base_id}", response_model=BasePublic)
async def update_base(
    base_id: uuid.UUID,
    body: BaseUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BasePublic:
    base = await service.rename_base(session, actor, base_id, body)
    await session.commit()
    return base


@router.delete("/bases/{base_id}", status_code=204)
async def delete_base(
    base_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_base(session, actor, base_id)
    await session.commit()


@router.get("/bases/{base_id}/tables", response_model=list[TablePublic])
async def list_tables(
    base_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TablePublic]:
    return await service.list_tables(session, actor, base_id)


@router.post("/bases/{base_id}/tables", status_code=201, response_model=TableDetail)
async def create_table(
    base_id: uuid.UUID,
    body: TableCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TableDetail:
    table = await service.create_table(session, actor, base_id, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/tables/{table.id}"
    return table


@router.get("/tables/{table_id}", response_model=TableDetail)
async def get_table(
    table_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TableDetail:
    return await service.get_table(session, actor, table_id)


@router.patch("/tables/{table_id}", response_model=TablePublic)
async def update_table(
    table_id: uuid.UUID,
    body: TableUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TablePublic:
    table = await service.rename_table(session, actor, table_id, body)
    await session.commit()
    return table


@router.delete("/tables/{table_id}", status_code=204)
async def delete_table(
    table_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_table(session, actor, table_id)
    await session.commit()
