import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.organizations import repository
from app.modules.organizations.models import Department, DepartmentKind
from app.modules.organizations.schemas import DepartmentCreate, DepartmentPublic, DepartmentUpdate
from app.modules.users import repository as users
from app.modules.users.models import User, UserStatus


async def _validate_parent(
    session: AsyncSession,
    actor: User,
    *,
    kind: DepartmentKind,
    parent_id: uuid.UUID | None,
) -> None:
    """A division sits at the top. A department sits under a division, or at the top."""
    if parent_id is None:
        return
    if kind == DepartmentKind.DIVISION:
        raise ProblemError(422, "A division cannot have a parent.")
    parent = await repository.get_department(
        session, organization_id=actor.organization_id, department_id=parent_id
    )
    if parent is None:
        raise ProblemError(422, "The parent department does not exist.")
    if parent.kind != DepartmentKind.DIVISION:
        raise ProblemError(422, "A department can only be placed under a division.")


async def _validate_head(
    session: AsyncSession, actor: User, head_user_id: uuid.UUID | None
) -> None:
    """The head is an active employee of the same organization (else 422, same as unknown)."""
    if head_user_id is None:
        return
    head = await users.get_in_organization(
        session, organization_id=actor.organization_id, user_id=head_user_id
    )
    if head is None or head.status != UserStatus.ACTIVE:
        raise ProblemError(422, "The head does not exist or is disabled.")


def to_public(department: Department, member_count: int) -> DepartmentPublic:
    return DepartmentPublic(
        id=department.id,
        name=department.name,
        kind=department.kind,
        parent_id=department.parent_id,
        head_user_id=department.head_user_id,
        member_count=member_count,
    )


async def public_of(session: AsyncSession, department: Department) -> DepartmentPublic:
    """One department as the API shows it, with the number of employees in it."""
    return to_public(department, await users.count_in_department(session, department.id))


async def list_public(session: AsyncSession, actor: User) -> list[DepartmentPublic]:
    departments = await repository.list_departments(session, organization_id=actor.organization_id)
    counts = await repository.member_counts(session, organization_id=actor.organization_id)
    return [to_public(department, counts.get(department.id, 0)) for department in departments]


async def get_department(
    session: AsyncSession, actor: User, department_id: uuid.UUID
) -> Department:
    department = await repository.get_department(
        session, organization_id=actor.organization_id, department_id=department_id
    )
    if department is None:
        raise ProblemError(404, "The department does not exist.")
    return department


async def create_department(
    session: AsyncSession, actor: User, data: DepartmentCreate
) -> Department:
    await _validate_parent(session, actor, kind=data.kind, parent_id=data.parent_id)
    await _validate_head(session, actor, data.head_user_id)
    if await repository.sibling_name_exists(
        session,
        organization_id=actor.organization_id,
        parent_id=data.parent_id,
        name=data.name,
    ):
        raise ProblemError(409, "A department with this name already exists here.")
    department = Department(
        organization_id=actor.organization_id,
        name=data.name,
        kind=data.kind,
        parent_id=data.parent_id,
        head_user_id=data.head_user_id,
    )
    repository.add_department(session, department)
    await session.flush()
    return department


async def update_department(
    session: AsyncSession, actor: User, department_id: uuid.UUID, data: DepartmentUpdate
) -> Department:
    department = await get_department(session, actor, department_id)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        raise ProblemError(422, "The name cannot be null.")

    new_name = changes.get("name", department.name)
    new_parent = changes["parent_id"] if "parent_id" in changes else department.parent_id
    await _validate_parent(session, actor, kind=department.kind, parent_id=new_parent)
    new_head = changes["head_user_id"] if "head_user_id" in changes else department.head_user_id
    if new_head != department.head_user_id:
        await _validate_head(session, actor, new_head)
    if await repository.sibling_name_exists(
        session,
        organization_id=actor.organization_id,
        parent_id=new_parent,
        name=new_name,
        exclude_id=department.id,
    ):
        raise ProblemError(409, "A department with this name already exists here.")

    department.name = new_name
    department.parent_id = new_parent
    department.head_user_id = new_head
    await session.flush()
    return department


async def delete_department(session: AsyncSession, actor: User, department_id: uuid.UUID) -> None:
    department = await get_department(session, actor, department_id)
    if await repository.has_children(session, department.id):
        raise ProblemError(409, "The department still has sub-departments.")
    if await users.count_in_department(session, department.id) > 0:
        raise ProblemError(409, "The department still has employees.")
    await repository.delete_department(session, department)
    await session.flush()
