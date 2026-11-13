import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import OrgRole, User, UserStatus


async def owner_exists(session: AsyncSession) -> bool:
    result = await session.execute(select(User.id).where(User.org_role == OrgRole.OWNER).limit(1))
    return result.first() is not None


async def get_by_employee_code(
    session: AsyncSession, *, organization_id: uuid.UUID, employee_code: str
) -> User | None:
    result = await session.execute(
        select(User).where(
            User.organization_id == organization_id, User.employee_code == employee_code
        )
    )
    return result.scalar_one_or_none()


async def get_in_organization(
    session: AsyncSession, *, organization_id: uuid.UUID, user_id: uuid.UUID
) -> User | None:
    """A user, but only if it belongs to the given organization (tenant boundary)."""
    result = await session.execute(
        select(User).where(User.organization_id == organization_id, User.id == user_id)
    )
    return result.scalar_one_or_none()


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_page(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    query: str | None,
    status: UserStatus | None,
    department_id: uuid.UUID | None,
    after_employee_code: str | None,
    limit: int,
) -> list[User]:
    """Users ordered by employee code, starting after the cursor. Fetches one row more than
    `limit` so the caller can tell whether another page exists."""
    stmt = select(User).where(User.organization_id == organization_id)
    if query:
        # Wildcards typed by the user are matched literally.
        pattern = f"%{_escape_like(query)}%"
        stmt = stmt.where(
            or_(
                User.employee_code.ilike(pattern, escape="\\"),
                User.full_name.ilike(pattern, escape="\\"),
            )
        )
    if status is not None:
        stmt = stmt.where(User.status == status)
    if department_id is not None:
        stmt = stmt.where(User.department_id == department_id)
    if after_employee_code is not None:
        stmt = stmt.where(User.employee_code > after_employee_code)
    stmt = stmt.order_by(User.employee_code).limit(limit + 1)
    return list((await session.execute(stmt)).scalars())


async def count_in_department(session: AsyncSession, department_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count()).select_from(User).where(User.department_id == department_id)
    )
    return int(result.scalar_one())


def add(session: AsyncSession, user: User) -> None:
    session.add(user)


async def search_active(
    session: AsyncSession, *, organization_id: uuid.UUID, query: str | None, limit: int
) -> list[User]:
    """Active employees by code or name, for pickers. Ordered by name."""
    stmt = select(User).where(
        User.organization_id == organization_id, User.status == UserStatus.ACTIVE
    )
    if query:
        pattern = f"%{_escape_like(query)}%"
        stmt = stmt.where(
            or_(
                User.employee_code.ilike(pattern, escape="\\"),
                User.full_name.ilike(pattern, escape="\\"),
            )
        )
    stmt = stmt.order_by(User.full_name, User.employee_code).limit(limit)
    return list((await session.execute(stmt)).scalars())


async def get_many(
    session: AsyncSession, *, organization_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[User]:
    """Employees of the organization by id, whatever their status (names stay readable)."""
    if not ids:
        return []
    stmt = select(User).where(User.organization_id == organization_id, User.id.in_(ids))
    return list((await session.execute(stmt.order_by(User.full_name))).scalars())
