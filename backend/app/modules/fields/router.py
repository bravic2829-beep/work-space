import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.fields import service
from app.modules.fields.schemas import (
    FieldAccessPublic,
    FieldAccessSet,
    FieldCreate,
    FieldPublic,
    FieldUpdate,
    PersonAccess,
    PersonAccessSet,
)
from app.modules.users.models import User

router = APIRouter(tags=["fields"])


@router.get("/tables/{table_id}/fields", response_model=list[FieldPublic])
async def list_fields(
    table_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[FieldPublic]:
    return await service.list_fields(session, actor, table_id)


@router.post("/tables/{table_id}/fields", status_code=201, response_model=FieldPublic)
async def create_field(
    table_id: uuid.UUID,
    body: FieldCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FieldPublic:
    field = await service.create_field(session, actor, table_id, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/fields/{field.id}"
    return field


@router.get("/fields/{field_id}", response_model=FieldPublic)
async def get_field(
    field_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FieldPublic:
    return await service.get_field(session, actor, field_id)


@router.patch("/fields/{field_id}", response_model=FieldPublic)
async def update_field(
    field_id: uuid.UUID,
    body: FieldUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FieldPublic:
    field = await service.update_field(session, actor, field_id, body)
    await session.commit()
    return field


@router.delete("/fields/{field_id}", status_code=204)
async def delete_field(
    field_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_field(session, actor, field_id)
    await session.commit()


@router.get("/tables/{table_id}/field-access", response_model=list[PersonAccess])
async def table_access(
    table_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[PersonAccess]:
    """Everybody who has a column rule on the table, with their rules (workspace admins)."""
    return await service.table_access(session, actor, table_id)


@router.get("/tables/{table_id}/field-access/{user_id}", response_model=PersonAccess)
async def person_access(
    table_id: uuid.UUID,
    user_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PersonAccess:
    return await service.person_access(session, actor, table_id, user_id)


@router.put("/tables/{table_id}/field-access/{user_id}", response_model=PersonAccess)
async def set_person_access(
    table_id: uuid.UUID,
    user_id: uuid.UUID,
    body: PersonAccessSet,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PersonAccess:
    """Set what one person sees of several columns in one go: hidden, read, edit, or null to
    go back to the default. All or nothing."""
    access = await service.set_person_access(session, actor, table_id, user_id, body)
    await session.commit()
    return access


@router.get("/fields/{field_id}/access", response_model=list[FieldAccessPublic])
async def list_access(
    field_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[FieldAccessPublic]:
    return await service.list_access(session, actor, field_id)


@router.put("/fields/{field_id}/access/{user_id}", response_model=FieldAccessPublic)
async def set_access(
    field_id: uuid.UUID,
    user_id: uuid.UUID,
    body: FieldAccessSet,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FieldAccessPublic:
    access = await service.set_access(session, actor, field_id, user_id, body)
    await session.commit()
    return access


@router.delete("/fields/{field_id}/access/{user_id}", status_code=204)
async def remove_access(
    field_id: uuid.UUID,
    user_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.remove_access(session, actor, field_id, user_id)
    await session.commit()
