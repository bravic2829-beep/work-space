import uuid

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_session
from app.modules.auth.dependencies import get_current_user
from app.modules.okr import export, service
from app.modules.okr.models import KrStatus, OkrLevel
from app.modules.okr.schemas import (
    CheckInCreate,
    CheckInPublic,
    CycleCreate,
    CyclePublic,
    CycleUpdate,
    KeyResultCreate,
    KeyResultUpdate,
    ObjectiveCreate,
    ObjectivePublic,
    ObjectiveUpdate,
    OkrDepartment,
    Overview,
    ReviewUpdate,
)
from app.modules.reports.export import XLSX
from app.modules.users.models import User

router = APIRouter(prefix="/okr", tags=["okr"])


@router.post("/key-results/{key_result_id}/tasks/{record_id}", status_code=204)
@router.delete("/key-results/{key_result_id}/tasks/{record_id}", status_code=204)
async def change_task_link(
    key_result_id: uuid.UUID,
    record_id: uuid.UUID,
    request: Request,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.change_task_link(
        session, actor, key_result_id, record_id, attach=request.method == "POST"
    )
    await session.commit()


# --- cycles --------------------------------------------------------------------------------------


@router.get("/cycles", response_model=list[CyclePublic])
async def list_cycles(
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CyclePublic]:
    """The cycles of the organization, the newest first. Everybody may read them."""
    return await service.list_cycles(session, actor)


@router.post("/cycles", status_code=201, response_model=CyclePublic)
async def create_cycle(
    body: CycleCreate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CyclePublic:
    """Open a cycle (a quarter, a year). Admins only."""
    cycle = await service.create_cycle(session, actor, body)
    await session.commit()
    return cycle


@router.patch("/cycles/{cycle_id}", response_model=CyclePublic)
async def update_cycle(
    cycle_id: uuid.UUID,
    body: CycleUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CyclePublic:
    """Rename a cycle, move its dates, close it or open it again. Admins only."""
    cycle = await service.update_cycle(session, actor, cycle_id, body)
    await session.commit()
    return cycle


@router.delete("/cycles/{cycle_id}", status_code=204)
async def delete_cycle(
    cycle_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_cycle(session, actor, cycle_id)
    await session.commit()


# --- the overview --------------------------------------------------------------------------------


@router.get("/overview", response_model=Overview)
async def overview(
    cycle_id: uuid.UUID,
    owner_id: uuid.UUID | None = None,
    level: OkrLevel | None = None,
    department_id: uuid.UUID | None = None,
    kr_status: list[KrStatus] = Query(default=[]),
    mine: bool = False,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Overview:
    """The objectives of a cycle the caller may see, with their key results and their progress.
    `kr_status` (repeatable) keeps only the key results in those states; `mine` keeps what the
    caller owns or works on."""
    return await service.overview(
        session,
        actor,
        cycle_id,
        owner_id=owner_id,
        level=level,
        department_id=department_id,
        kr_status=kr_status or None,
        mine=mine,
    )


@router.get("/export", response_class=Response)
async def export_overview(data: Overview = Depends(overview)) -> Response:
    content = await run_in_threadpool(export.build, data)
    return Response(
        content,
        media_type=XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="okr-{data.cycle.starts_on}.xlsx"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# --- objectives ----------------------------------------------------------------------------------


@router.post("/objectives", status_code=201, response_model=ObjectivePublic)
async def create_objective(
    body: ObjectiveCreate,
    response: Response,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    objective = await service.create_objective(session, actor, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/okr/objectives/{objective.id}"
    return objective


@router.get("/objectives/{objective_id}", response_model=ObjectivePublic)
async def get_objective(
    objective_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    return await service.get_objective(session, actor, objective_id)


@router.patch("/objectives/{objective_id}", response_model=ObjectivePublic)
async def update_objective(
    objective_id: uuid.UUID,
    body: ObjectiveUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    objective = await service.update_objective(session, actor, objective_id, body)
    await session.commit()
    return objective


@router.delete("/objectives/{objective_id}", status_code=204)
async def delete_objective(
    objective_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_objective(session, actor, objective_id)
    await session.commit()


@router.patch("/objectives/{objective_id}/review", response_model=ObjectivePublic)
async def review_objective(
    objective_id: uuid.UUID,
    body: ReviewUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    """The score (0 to 1) and the notes about an objective. Not for its owner."""
    objective = await service.review_objective(session, actor, objective_id, body)
    await session.commit()
    return objective


# --- key results ---------------------------------------------------------------------------------


@router.post(
    "/objectives/{objective_id}/key-results", status_code=201, response_model=ObjectivePublic
)
async def create_key_result(
    objective_id: uuid.UUID,
    body: KeyResultCreate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    """Add a key result; the answer is the whole objective, with its new progress."""
    objective = await service.create_key_result(session, actor, objective_id, body)
    await session.commit()
    return objective


@router.patch("/key-results/{key_result_id}", response_model=ObjectivePublic)
async def update_key_result(
    key_result_id: uuid.UUID,
    body: KeyResultUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    objective = await service.update_key_result(session, actor, key_result_id, body)
    await session.commit()
    return objective


@router.delete("/key-results/{key_result_id}", status_code=204)
async def delete_key_result(
    key_result_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_key_result(session, actor, key_result_id)
    await session.commit()


@router.patch("/key-results/{key_result_id}/review", response_model=ObjectivePublic)
async def review_key_result(
    key_result_id: uuid.UUID,
    body: ReviewUpdate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    objective = await service.review_key_result(session, actor, key_result_id, body)
    await session.commit()
    return objective


# --- check-ins -----------------------------------------------------------------------------------


@router.post(
    "/key-results/{key_result_id}/check-ins", status_code=201, response_model=ObjectivePublic
)
async def check_in(
    key_result_id: uuid.UUID,
    body: CheckInCreate,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ObjectivePublic:
    """The weekly update of a key result: its new value, status and a note. The answer is the
    whole objective, with the new progress."""
    objective = await service.check_in(session, actor, key_result_id, body)
    await session.commit()
    return objective


@router.get("/key-results/{key_result_id}/check-ins", response_model=list[CheckInPublic])
async def list_check_ins(
    key_result_id: uuid.UUID,
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CheckInPublic]:
    """The history of a key result, the newest first."""
    return await service.list_check_ins(session, actor, key_result_id)


@router.get("/departments", response_model=list[OkrDepartment])
async def list_departments(
    actor: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[OkrDepartment]:
    """The departments (names only) for choosing one on a department objective or filtering by
    it. `can_create` is true for the ones the caller may make objectives for."""
    return await service.list_departments(session, actor)
