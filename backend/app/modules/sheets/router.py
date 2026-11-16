import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, Page
from app.modules.auth.dependencies import get_current_user
from app.modules.records import service as records
from app.modules.records.schemas import RecordCreate, RecordPublic
from app.modules.sheets import service
from app.modules.sheets.schemas import (
    MemberPublic,
    MemberRoleChange,
    SheetCreate,
    SheetPublic,
    SheetUpdate,
)
from app.modules.users.models import User

router = APIRouter(tags=["sheets"])


@router.get("/sheets", response_model=list[SheetPublic])
async def list_sheets(
    table_id: uuid.UUID | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[SheetPublic]:
    """The sheets the caller may open. An organization admin sees all of them."""
    return await service.list_sheets(session, actor, table_id)


@router.post("/tables/{table_id}/sheets", status_code=201, response_model=SheetPublic)
async def create_sheet(
    table_id: uuid.UUID,
    body: SheetCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SheetPublic:
    """Give one person a sheet of this table. For admins of the table's workspace."""
    sheet = await service.create_sheet(session, actor, table_id, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/sheets/{sheet.id}"
    return sheet


@router.get("/sheets/{sheet_id}", response_model=SheetPublic)
async def get_sheet(
    sheet_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SheetPublic:
    return await service.get_sheet(session, actor, sheet_id)


@router.patch("/sheets/{sheet_id}", response_model=SheetPublic)
async def rename_sheet(
    sheet_id: uuid.UUID,
    body: SheetUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SheetPublic:
    sheet = await service.rename_sheet(session, actor, sheet_id, body.name)
    await session.commit()
    return sheet


@router.delete("/sheets/{sheet_id}", status_code=204)
async def archive_sheet(
    sheet_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Archive the sheet. Its tasks stay in the table."""
    await service.archive_sheet(session, actor, sheet_id)
    await session.commit()


@router.get("/sheets/{sheet_id}/members", response_model=list[MemberPublic])
async def list_members(
    sheet_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[MemberPublic]:
    return await service.list_members(session, actor, sheet_id)


@router.put("/sheets/{sheet_id}/members/{user_id}", response_model=MemberPublic)
async def set_member(
    sheet_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberRoleChange,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MemberPublic:
    """Add a person to the sheet, or change their role."""
    member = await service.set_member(session, actor, sheet_id, user_id, body.role)
    await session.commit()
    return member


@router.delete("/sheets/{sheet_id}/members/{user_id}", status_code=204)
async def remove_member(
    sheet_id: uuid.UUID,
    user_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.remove_member(session, actor, sheet_id, user_id)
    await session.commit()


@router.get("/sheets/{sheet_id}/records", response_model=Page[RecordPublic])
async def list_sheet_records(
    sheet_id: uuid.UUID,
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    sort: list[str] = Query(default=[]),
    filter: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[RecordPublic]:
    """The tasks of the sheet: the table's records that name its owner as assignee."""
    return await service.list_sheet_records(
        session, actor, sheet_id, limit=limit, cursor=cursor, sort=sort, filter_json=filter
    )


@router.post("/sheets/{sheet_id}/records", status_code=201, response_model=RecordPublic)
async def create_sheet_record(
    sheet_id: uuid.UUID,
    body: RecordCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Add a task to the sheet (its owner becomes the assignee). Needs the editor role."""
    record, public = await service.create_sheet_record(session, actor, sheet_id, body.data)
    await session.commit()
    response.headers["Location"] = f"/api/v1/records/{record.id}"
    response.headers["ETag"] = records.etag(record)
    return public
