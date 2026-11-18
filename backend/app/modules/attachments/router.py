import uuid

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, Page
from app.modules.attachments import service, trash
from app.modules.auth.dependencies import get_current_user
from app.modules.records import service as records
from app.modules.records.schemas import RecordPublic
from app.modules.users.models import User

router = APIRouter(tags=["attachments"])


@router.post("/records/{record_id}/attachments", status_code=201, response_model=RecordPublic)
async def upload_attachment(
    record_id: uuid.UUID,
    field_id: uuid.UUID,
    request: Request,
    response: Response,
    x_file_name: str = Header(description="The file name, URL-encoded (encodeURIComponent)."),
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Add a file to a files column. The body is the raw file (no multipart); the name goes in
    `X-File-Name`. Returns the task with its updated list of files (same version)."""
    length = request.headers.get("content-length")
    record, public = await service.upload(
        session,
        actor,
        record_id,
        field_id,
        x_file_name,
        int(length) if length and length.isdigit() else None,
        request.stream(),
        request.app.state.settings,
    )
    await session.commit()
    response.headers["ETag"] = records.etag(record)
    return public


@router.get("/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: uuid.UUID,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    """Download a file. Always a download (never shown inside the page), with its own name."""
    attachment, path = await service.for_download(
        session, actor, attachment_id, request.app.state.settings
    )
    return FileResponse(
        path,
        media_type=attachment.content_type,
        filename=attachment.name,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.delete("/attachments/{attachment_id}", response_model=RecordPublic)
async def delete_attachment(
    attachment_id: uuid.UUID,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Move a file to Trash. Returns the task with its updated list of files."""
    record, public = await service.remove(session, actor, attachment_id)
    await session.commit()
    response.headers["ETag"] = records.etag(record)
    return public


@router.get("/trash/attachments", response_model=Page[trash.FileTrashItem])
async def list_trashed_attachments(
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[trash.FileTrashItem]:
    return await trash.list_files(session, actor, limit=limit, cursor=cursor)


@router.post("/trash/attachments/{attachment_id}/restore", status_code=204)
async def restore_attachment(
    attachment_id: uuid.UUID,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await trash.restore(session, actor, attachment_id, request.app.state.settings.attachments_dir)
    await session.commit()


@router.get("/trash/attachments/{attachment_id}/download")
async def download_trashed_attachment(
    attachment_id: uuid.UUID,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FileResponse:
    file, path = await trash.for_download(
        session, actor, attachment_id, request.app.state.settings.attachments_dir
    )
    return FileResponse(
        path,
        media_type=file.content_type,
        filename=file.name,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.delete("/trash/attachments/{attachment_id}", status_code=204)
async def delete_trashed_attachment(
    attachment_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await trash.delete_forever(session, actor, attachment_id)
    await session.commit()
