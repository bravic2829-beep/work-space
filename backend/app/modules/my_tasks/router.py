from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.pagination import DEFAULT_PAGE_SIZE, Page
from app.modules.auth.dependencies import get_current_user
from app.modules.my_tasks import service
from app.modules.my_tasks.schemas import MyTask
from app.modules.users.models import User

router = APIRouter(tags=["my-tasks"])


@router.get("/me/tasks", response_model=Page[MyTask])
async def list_my_tasks(
    scope: Literal["assigned", "today", "following", "review"] = "assigned",
    date: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
    cursor: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Page[MyTask]:
    """My tasks across all tables. `scope=assigned` (default): assigned to me. `scope=today`:
    assigned and due on `date` (YYYY-MM-DD, the caller's own day; the server's UTC day when left
    out). `scope=following`: I am a follower. `scope=review`: waiting for my review."""
    return await service.list_my_tasks(
        session, actor, scope=scope, day=date, limit=limit, cursor=cursor
    )
