import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.activity import service
from app.modules.activity.service import ActivityPublic
from app.modules.auth.dependencies import get_current_user
from app.modules.users.models import User

router = APIRouter(tags=["activity"])


@router.get("/records/{record_id}/activity", response_model=list[ActivityPublic])
async def list_activity(
    record_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ActivityPublic]:
    """The history of a task, newest first, without the columns the caller may not see."""
    return await service.list_for_record(session, actor, record_id)
