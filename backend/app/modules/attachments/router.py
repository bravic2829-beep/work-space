import uuid

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.attachments import service
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
    request: Request,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RecordPublic:
    """Remove a file from the task. Returns the task with its updated list of files."""
    record, public = await service.remove(session, actor, attachment_id, request.app.state.settings)
    await session.commit()
    response.headers["ETag"] = records.etag(record)
    return public
