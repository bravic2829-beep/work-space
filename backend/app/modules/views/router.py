import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.users.models import User
from app.modules.views import service
from app.modules.views.schemas import ViewCreate, ViewPublic, ViewUpdate

router = APIRouter(tags=["views"])


@router.get("/tables/{table_id}/views", response_model=list[ViewPublic])
async def list_views(
    table_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ViewPublic]:
    """My own views of the table (other people's views are never listed)."""
    return await service.list_views(session, actor, table_id)


@router.post("/tables/{table_id}/views", status_code=201, response_model=ViewPublic)
async def create_view(
    table_id: uuid.UUID,
    body: ViewCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ViewPublic:
    view = await service.create_view(session, actor, table_id, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/views/{view.id}"
    return view


@router.get("/views/{view_id}", response_model=ViewPublic)
async def get_view(
    view_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ViewPublic:
    return await service.get_view(session, actor, view_id)


@router.patch("/views/{view_id}", response_model=ViewPublic)
async def update_view(
    view_id: uuid.UUID,
    body: ViewUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ViewPublic:
    view = await service.update_view(session, actor, view_id, body)
    await session.commit()
    return view


@router.delete("/views/{view_id}", status_code=204)
async def delete_view(
    view_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_view(session, actor, view_id)
    await session.commit()
