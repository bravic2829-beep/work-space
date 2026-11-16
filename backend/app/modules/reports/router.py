import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.reports import service
from app.modules.reports.service import Overview, ReportTable
from app.modules.users.models import User

router = APIRouter(tags=["reports"])


@router.get("/reports/tables", response_model=list[ReportTable])
async def report_tables(
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ReportTable]:
    """The task tables the caller can see a report of."""
    return await service.report_tables(session, actor)


@router.get("/reports/overview", response_model=Overview)
async def overview(
    table_id: uuid.UUID,
    date: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Overview:
    """Counts over the tasks of the table that the caller may open. `date` is the caller's day
    (YYYY-MM-DD), for what is due today and what is late."""
    return await service.overview(session, actor, table_id, date)
