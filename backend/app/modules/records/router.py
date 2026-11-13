import uuid

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, Page
from app.modules.auth.dependencies import get_current_user
from app.modules.records import service
from app.modules.records.schemas import RecordCreate, RecordPublic, RecordUpdate
from app.modules.users.models import User

router = APIRouter(tags=["records"])


@router.get("/tables/{table_id}/records", response_model=Page[RecordPublic])
async def list_records(
    table_id: uuid.UUID,
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    sort: list[str] = Query(default=[]),
    filter: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[RecordPublic]:
    """Records the caller may see. `sort=<field_id>:asc|desc` (repeatable) and
    `filter=[{"field": <id>, "op": "eq", "value": ...}]` (JSON). See docs/api-conventions.md."""
    return await service.list_records(
        session, actor, table_id, limit=limit, cursor=cursor, sort=sort, filter_json=filter
    )


@router.post("/tables/{table_id}/records", status_code=201, response_model=RecordPublic)
async def create_record(
    table_id: uuid.UUID,
    body: RecordCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    record, public = await service.create_record(session, actor, table_id, body.data)
    await session.commit()
    response.headers["Location"] = f"/api/v1/records/{record.id}"
    response.headers["ETag"] = service.etag(record)
    return public


@router.get("/records/{record_id}", response_model=RecordPublic)
async def get_record(
    record_id: uuid.UUID,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    record, public = await service.get_record(session, actor, record_id)
    response.headers["ETag"] = service.etag(record)
    return public


@router.patch("/records/{record_id}", response_model=RecordPublic)
async def update_record(
    record_id: uuid.UUID,
    body: RecordUpdate,
    response: Response,
    if_match: str | None = Header(default=None),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    record, public = await service.update_record(session, actor, record_id, body.data, if_match)
    await session.commit()
    response.headers["ETag"] = service.etag(record)
    return public


@router.delete("/records/{record_id}", status_code=204)
async def delete_record(
    record_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_record(session, actor, record_id)
    await session.commit()
