import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.modules.auth.dependencies import require_admin
from app.modules.organizations import repository, service
from app.modules.organizations.models import Department
from app.modules.organizations.schemas import (
    DepartmentCreate,
    DepartmentPublic,
    DepartmentUpdate,
)
from app.modules.users.models import User

# Every endpoint here is for organization admins only (the HR module is hidden from others).
router = APIRouter(tags=["departments"], dependencies=[Depends(require_admin)])


@router.get("/departments", response_model=list[DepartmentPublic])
async def list_departments(
    actor: User = Depends(require_admin), session: AsyncSession = Depends(get_session)
) -> list[Department]:
    return await repository.list_departments(session, organization_id=actor.organization_id)


@router.post("/departments", status_code=201, response_model=DepartmentPublic)
async def create_department(
    body: DepartmentCreate,
    response: Response,
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Department:
    department = await service.create_department(session, actor, body)
    await session.commit()
    response.headers["Location"] = f"/api/v1/departments/{department.id}"
    return department


@router.get("/departments/{department_id}", response_model=DepartmentPublic)
async def get_department(
    department_id: uuid.UUID,
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Department:
    return await service.get_department(session, actor, department_id)


@router.patch("/departments/{department_id}", response_model=DepartmentPublic)
async def update_department(
    department_id: uuid.UUID,
    body: DepartmentUpdate,
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> Department:
    department = await service.update_department(session, actor, department_id, body)
    await session.commit()
    return department


@router.delete("/departments/{department_id}", status_code=204)
async def delete_department(
    department_id: uuid.UUID,
    actor: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    await service.delete_department(session, actor, department_id)
    await session.commit()
