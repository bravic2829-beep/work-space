from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import MIN_PASSWORD_LENGTH, hash_password_async
from app.modules.organizations import repository as organizations
from app.modules.organizations.models import Organization
from app.modules.users import repository as users
from app.modules.users.models import OrgRole, User, UserLevel, UserStatus
from app.modules.workspaces.service import create_personal_workspace

# Arbitrary constant: serializes concurrent "create the first owner" calls.
_SUPER_ADMIN_LOCK_KEY = 7_201_001


class OwnerAlreadyExistsError(Exception):
    """An owner already exists, so a new Super Admin must not be created."""


class InvalidSuperAdminInputError(ValueError):
    """The employee code, name or password does not meet the rules."""


async def create_super_admin(
    session: AsyncSession,
    *,
    employee_code: str,
    full_name: str,
    password: str,
    organization_name: str,
) -> User:
    """Create the first owner (and the organization, when missing). The caller commits."""
    employee_code = employee_code.strip()
    full_name = full_name.strip()
    organization_name = organization_name.strip()
    if not employee_code or not full_name or not organization_name:
        raise InvalidSuperAdminInputError("Employee code, full name and organization are required")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise InvalidSuperAdminInputError(
            f"Password must have at least {MIN_PASSWORD_LENGTH} characters"
        )

    # Held until the transaction ends. A second concurrent seed waits, then sees the owner.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": _SUPER_ADMIN_LOCK_KEY}
    )
    if await users.owner_exists(session):
        raise OwnerAlreadyExistsError

    organization = await organizations.get_first(session)
    if organization is None:
        organization = Organization(name=organization_name)
        organizations.add(session, organization)
        await session.flush()

    user = User(
        organization_id=organization.id,
        employee_code=employee_code,
        full_name=full_name,
        password_hash=await hash_password_async(password),
        org_role=OrgRole.OWNER,
        level=UserLevel.ADMIN,
        status=UserStatus.ACTIVE,
    )
    users.add(session, user)
    await session.flush()
    await create_personal_workspace(session, user)
    return user
