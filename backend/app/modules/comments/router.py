import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, Page
from app.modules.auth.dependencies import get_current_user
from app.modules.comments import service
from app.modules.comments.schemas import CommentCreate, CommentPublic
from app.modules.users.models import User

router = APIRouter(tags=["comments"])


@router.get("/records/{record_id}/comments", response_model=Page[CommentPublic])
async def list_comments(
    record_id: uuid.UUID,
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[CommentPublic]:
    return await service.list_comments(session, actor, record_id, limit=limit, cursor=cursor)


@router.post("/records/{record_id}/comments", status_code=201, response_model=CommentPublic)
async def create_comment(
    record_id: uuid.UUID,
    body: CommentCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CommentPublic:
    comment = await service.create_comment(session, actor, record_id, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/comments/{comment.id}"
    return comment


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_comment(session, actor, comment_id)
    await session.commit()
