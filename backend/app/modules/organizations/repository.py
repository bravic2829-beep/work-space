import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.organizations.models import Department, Organization
from app.modules.users.models import User


async def get_first(session: AsyncSession) -> Organization | None:
    """The single organization of this deployment, if it exists."""
    result = await session.execute(select(Organization).order_by(Organization.created_at).limit(1))
    return result.scalar_one_or_none()


def add(session: AsyncSession, organization: Organization) -> None:
    session.add(organization)


async def get_department(
    session: AsyncSession, *, organization_id: uuid.UUID, department_id: uuid.UUID
) -> Department | None:
    """A department, but only if it belongs to the given organization (tenant boundary)."""
    result = await session.execute(
        select(Department).where(
            Department.organization_id == organization_id, Department.id == department_id
        )
    )
    return result.scalar_one_or_none()


async def list_departments(
    session: AsyncSession, *, organization_id: uuid.UUID
) -> list[Department]:
    result = await session.execute(
        select(Department)
        .where(Department.organization_id == organization_id)
        .order_by(Department.kind, Department.name)
    )
    return list(result.scalars())


async def member_counts(
    session: AsyncSession, *, organization_id: uuid.UUID
) -> dict[uuid.UUID, int]:
    """Employees per department, for the departments that have any."""
    result = await session.execute(
        select(User.department_id, func.count())
        .where(User.organization_id == organization_id, User.department_id.is_not(None))
        .group_by(User.department_id)
    )
    return {department_id: int(count) for department_id, count in result.all() if department_id}


async def sibling_name_exists(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> bool:
    """True when another department with the same parent already uses this name (any case)."""
    stmt = select(Department.id).where(
        Department.organization_id == organization_id,
        func.lower(Department.name) == name.lower(),
        Department.parent_id.is_(None) if parent_id is None else Department.parent_id == parent_id,
    )
    if exclude_id is not None:
        stmt = stmt.where(Department.id != exclude_id)
    return (await session.execute(stmt.limit(1))).first() is not None


async def has_children(session: AsyncSession, department_id: uuid.UUID) -> bool:
    result = await session.execute(
        select(Department.id).where(Department.parent_id == department_id).limit(1)
    )
    return result.first() is not None


def add_department(session: AsyncSession, department: Department) -> None:
    session.add(department)


async def delete_department(session: AsyncSession, department: Department) -> None:
    await session.delete(department)
