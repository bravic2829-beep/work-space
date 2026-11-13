import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, Page
from app.modules.auth.dependencies import get_current_user
from app.modules.notifications import service
from app.modules.notifications.schemas import NotificationPublic, NotificationUpdate, UnreadCount
from app.modules.users.models import User

router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=Page[NotificationPublic])
async def list_notifications(
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    unread_only: bool = False,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[NotificationPublic]:
    """My notifications, newest first. Nobody else's are ever returned."""
    return await service.list_notifications(
        session, actor, limit=limit, cursor=cursor, unread_only=unread_only
    )


@router.get("/notifications/unread-count", response_model=UnreadCount)
async def unread_count(
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UnreadCount:
    return await service.unread_count(session, actor)


@router.post("/notifications/read-all", response_model=UnreadCount)
async def mark_all_read(
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UnreadCount:
    """Mark all of my notifications read."""
    result = await service.mark_all_read(session, actor)
    await session.commit()
    return result


@router.patch("/notifications/{notification_id}", response_model=NotificationPublic)
async def update_notification(
    notification_id: uuid.UUID,
    body: NotificationUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationPublic:
    """Mark one of my notifications read (`{"read": true}`) or unread."""
    result = await service.update_notification(session, actor, notification_id, body)
    await session.commit()
    return result
