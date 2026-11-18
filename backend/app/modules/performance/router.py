import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.performance import service
from app.modules.performance.schemas import (
    ChangePublic,
    Criteria,
    CriterionCreate,
    CriterionPublic,
    CriterionUpdate,
    Period,
    Scores,
    ScoreSet,
)
from app.modules.users.models import User

router = APIRouter(prefix="/performance", tags=["performance"])


@router.get("/criteria", response_model=Criteria)
async def list_criteria(
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Criteria:
    """The criteria and their weights. Everybody may read them; a new organization starts with
    six."""
    result = await service.list_criteria(session, actor)
    await session.commit()
    return result


@router.post("/criteria", status_code=201, response_model=CriterionPublic)
async def create_criterion(
    body: CriterionCreate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CriterionPublic:
    """Add a criterion. Admins only."""
    criterion = await service.create_criterion(session, actor, body)
    await session.commit()
    return criterion


@router.patch("/criteria/{criterion_id}", response_model=CriterionPublic)
async def update_criterion(
    criterion_id: uuid.UUID,
    body: CriterionUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CriterionPublic:
    """Rename, reweigh, change the source of, or switch off a criterion. Admins only; the change
    is kept in its history."""
    criterion = await service.update_criterion(session, actor, criterion_id, body)
    await session.commit()
    return criterion


@router.get("/criteria/{criterion_id}/history", response_model=list[ChangePublic])
async def criterion_history(
    criterion_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ChangePublic]:
    """Who changed this criterion, when, how, and why. Admins only."""
    return await service.history(session, actor, criterion_id)


@router.get("/scores", response_model=Scores)
async def scores(
    period: Annotated[Period | None, Query()] = None,
    department_id: uuid.UUID | None = None,
    date: str | None = None,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Scores:
    """The score of each person the caller may see, for a month (this month when absent)."""
    result = await service.scores(
        session, actor, period=period, department_id=department_id, day=date
    )
    await session.commit()
    return result


@router.put("/scores", status_code=204)
async def set_score(
    body: ScoreSet,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Write the score of a person for a criterion that is scored by a person. An admin or the
    manager of the person; the reason is kept."""
    await service.set_score(session, actor, body)
    await session.commit()
    return Response(status_code=204)
