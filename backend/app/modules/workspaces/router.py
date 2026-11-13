import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.users.models import User
from app.modules.workspaces import service
from app.modules.workspaces.schemas import (
    MemberCreate,
    MemberPublic,
    MemberUpdate,
    WorkspaceCreate,
    WorkspacePublic,
    WorkspaceUpdate,
)

router = APIRouter(tags=["workspaces"])


@router.get("/workspaces", response_model=list[WorkspacePublic])
async def list_workspaces(
    scope: Literal["member", "all"] = "member",
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[WorkspacePublic]:
    """Workspaces I belong to. `scope=all` lists every workspace and is for admins only."""
    return await service.list_workspaces(session, actor, scope)


@router.post("/workspaces", status_code=201, response_model=WorkspacePublic)
async def create_workspace(
    body: WorkspaceCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspacePublic:
    workspace = await service.create_workspace(session, actor, body.name)
    await session.commit()
    response.headers["Location"] = f"/api/v1/workspaces/{workspace.id}"
    return workspace


@router.get("/workspaces/{workspace_id}", response_model=WorkspacePublic)
async def get_workspace(
    workspace_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspacePublic:
    return await service.get_workspace(session, actor, workspace_id)


@router.patch("/workspaces/{workspace_id}", response_model=WorkspacePublic)
async def update_workspace(
    workspace_id: uuid.UUID,
    body: WorkspaceUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspacePublic:
    workspace = await service.rename_workspace(session, actor, workspace_id, body.name)
    await session.commit()
    return workspace


@router.delete("/workspaces/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_workspace(session, actor, workspace_id)
    await session.commit()


@router.get("/workspaces/{workspace_id}/members", response_model=list[MemberPublic])
async def list_members(
    workspace_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[MemberPublic]:
    return await service.list_members(session, actor, workspace_id)


@router.post("/workspaces/{workspace_id}/members", status_code=201, response_model=MemberPublic)
async def add_member(
    workspace_id: uuid.UUID,
    body: MemberCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MemberPublic:
    member = await service.add_member(session, actor, workspace_id, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/workspaces/{workspace_id}/members/{member.user_id}"
    return member


@router.patch("/workspaces/{workspace_id}/members/{user_id}", response_model=MemberPublic)
async def update_member(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MemberPublic:
    member = await service.update_member(session, actor, workspace_id, user_id, body)
    await session.commit()
    return member


@router.delete("/workspaces/{workspace_id}/members/{user_id}", status_code=204)
async def remove_member(
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.remove_member(session, actor, workspace_id, user_id)
    await session.commit()
