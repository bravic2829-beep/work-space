import uuid

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, Page
from app.modules.auth.dependencies import get_current_user
from app.modules.records import (  # noqa: F401 (live registers its listeners)
    groups,
    handover,
    live,
    review,
    service,
    sharing,
    timer,
    trash,
)
from app.modules.records.schemas import (
    RecordCreate,
    RecordPublic,
    RecordUpdate,
    ReviewAction,
    TimerAction,
)
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


@router.get("/tables/{table_id}/groups", response_model=groups.Groups)
async def list_groups(
    table_id: uuid.UUID,
    group_by: uuid.UUID,
    bucket: str | None = None,
    aggregate: list[str] = Query(default=[]),
    filter: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> groups.Groups:
    """The records folded into groups of one column, each with its number of records and totals.
    `bucket=day|week|month` for a date column; `aggregate=<field_id>:sum|avg|min|max` (repeatable)
    for a number column; `filter` as for the record list. Every group carries the `filter` that
    selects its records, so open it with the normal record list."""
    return await service.list_groups(
        session,
        actor,
        table_id,
        group_by=str(group_by),
        bucket=bucket,
        aggregates=aggregate,
        filter_json=filter,
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


@router.get("/records/{record_id}/viewers", response_model=sharing.RecordViewers)
async def get_record_viewers(
    record_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> sharing.RecordViewers:
    """Who can see this record: the people named on it, and the size of the workspace."""
    return await service.record_viewers(session, actor, record_id)


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
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_record(
        session, actor, record_id, request.app.state.settings.attachments_dir
    )
    await session.commit()


@router.post("/records/{record_id}/review", response_model=RecordPublic)
async def review_record(
    record_id: uuid.UUID,
    body: ReviewAction,
    response: Response,
    if_match: str | None = Header(default=None),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Report done (`submit`), approve or reject. Needs `If-Match` like a change does."""
    record, public = await review.review_record(
        session, actor, record_id, body.action, if_match, body.reason
    )
    await session.commit()
    response.headers["ETag"] = service.etag(record)
    return public


@router.post("/records/{record_id}/handover", response_model=RecordPublic)
async def hand_over(
    record_id: uuid.UUID,
    body: handover.HandoverRequest,
    response: Response,
    if_match: str | None = Header(default=None),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Pass the task to someone who can already open the table, with the result and documents."""
    record, public = await handover.hand_over(session, actor, record_id, body, if_match)
    await session.commit()
    response.headers["ETag"] = service.etag(record)
    return public


@router.post("/records/{record_id}/timer", response_model=RecordPublic)
async def timer_record(
    record_id: uuid.UUID,
    body: TimerAction,
    response: Response,
    if_match: str | None = Header(default=None),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Start the task timer (who gave the task) or stop it (the assignee). Needs `If-Match`."""
    record, public = await timer.timer_record(
        session, actor, record_id, body.action, if_match, field_id=body.field_id
    )
    await session.commit()
    response.headers["ETag"] = service.etag(record)
    return public


@router.get("/trash/records", response_model=Page[trash.TrashItem])
async def list_trash(
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[trash.TrashItem]:
    """The records I deleted in the last 30 days. Nobody else's trash is ever listed."""
    return await trash.list_trash(session, actor, limit=limit, cursor=cursor)


@router.delete("/trash/records/{record_id}", status_code=204)
async def delete_from_trash(
    record_id: uuid.UUID,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove a record in the trash for good. There is no undo."""
    await trash.delete_forever(
        session, actor, record_id, request.app.state.settings.attachments_dir
    )
    await session.commit()


@router.post("/records/{record_id}/restore", response_model=RecordPublic)
async def restore_record(
    record_id: uuid.UUID,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Take a record I deleted back out of the trash (within 30 days)."""
    record, public = await trash.restore_record(session, actor, record_id)
    await session.commit()
    response.headers["ETag"] = service.etag(record)
    return public
