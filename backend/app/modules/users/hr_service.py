"""Human resources: admins manage employee accounts (create, list, edit, disable)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import flush_or_conflict
from app.core.errors import ProblemError
from app.core.pagination import Page, decode_cursor, encode_cursor
from app.core.security import hash_password_async
from app.modules.auth import repository as auth_repository
from app.modules.organizations import repository as organizations
from app.modules.users import repository as users
from app.modules.users.models import OrgRole, User, UserLevel, UserStatus
from app.modules.users.schemas import UserCreate, UserPublic, UserUpdate
from app.modules.workspaces.service import create_personal_workspace

# Changing any of these on your own account could lock the organization out of its admin.
_PRIVILEGE_FIELDS = {"org_role", "level", "status"}


def _check_level_matches_role(level: UserLevel, org_role: OrgRole) -> None:
    """Business level 'admin' and the organization role 'admin' always go together."""
    if (level == UserLevel.ADMIN) != (org_role == OrgRole.ADMIN):
        raise ProblemError(
            422, "The level 'admin' and the organization role 'admin' must be used together."
        )


async def _validate_references(
    session: AsyncSession,
    actor: User,
    *,
    department_id: uuid.UUID | None,
    manager_id: uuid.UUID | None,
    target_id: uuid.UUID | None = None,
) -> None:
    """The department and the manager must exist in the same organization (tenant boundary)."""
    if department_id is not None:
        department = await organizations.get_department(
            session, organization_id=actor.organization_id, department_id=department_id
        )
        if department is None:
            raise ProblemError(422, "The department does not exist.")

    if manager_id is None:
        return
    if target_id is not None and manager_id == target_id:
        raise ProblemError(422, "An employee cannot be their own manager.")
    manager = await users.get_in_organization(
        session, organization_id=actor.organization_id, user_id=manager_id
    )
    if manager is None:
        raise ProblemError(422, "The manager does not exist.")
    if manager.status != UserStatus.ACTIVE:
        raise ProblemError(422, "The manager account is disabled.")

    if target_id is not None:
        # Walk up the management chain: it must never lead back to the employee being edited.
        seen: set[uuid.UUID] = set()
        current: User | None = manager
        while current is not None and current.manager_id is not None:
            if current.manager_id == target_id:
                raise ProblemError(422, "This manager assignment would create a loop.")
            if current.manager_id in seen:
                break
            seen.add(current.manager_id)
            current = await users.get_in_organization(
                session, organization_id=actor.organization_id, user_id=current.manager_id
            )


async def create_user(session: AsyncSession, actor: User, data: UserCreate) -> User:
    """Create an account and its personal workspace in one transaction. The caller commits."""
    _check_level_matches_role(data.level, data.org_role)
    await _validate_references(
        session, actor, department_id=data.department_id, manager_id=data.manager_id
    )
    employee_code = data.employee_code
    if employee_code is None:
        employee_code = await users.next_auto_employee_code(
            session, organization_id=actor.organization_id
        )
    else:
        existing = await users.get_by_employee_code(
            session, organization_id=actor.organization_id, employee_code=employee_code
        )
        if existing is not None:
            raise ProblemError(409, "This employee code is already in use.")

    user = User(
        organization_id=actor.organization_id,
        employee_code=employee_code,
        full_name=data.full_name,
        password_hash=await hash_password_async(data.password),
        org_role=data.org_role,
        level=data.level,
        status=UserStatus.ACTIVE,
        department_id=data.department_id,
        manager_id=data.manager_id,
    )
    users.add(session, user)
    await flush_or_conflict(session, "This employee code is already in use.")
    await create_personal_workspace(session, user)
    return user


async def reset_password(
    session: AsyncSession, actor: User, user_id: uuid.UUID, new_password: str
) -> None:
    """Set a temporary password for an employee who forgot theirs. The caller commits.

    The employee is signed out everywhere and must choose their own password at the next sign-in.
    """
    target = await get_user(session, actor, user_id)
    if target.org_role == OrgRole.OWNER:
        # The owner is the root of trust: nobody else can take over the account.
        raise ProblemError(403, "The owner's password cannot be reset by others.")
    if target.id == actor.id:
        raise ProblemError(409, "Use Change password to change your own password.")
    target.password_hash = await hash_password_async(new_password)
    target.must_change_password = True
    await auth_repository.revoke_all_for_user(session, user_id=target.id, now=datetime.now(UTC))
    await session.flush()


async def get_user(session: AsyncSession, actor: User, user_id: uuid.UUID) -> User:
    user = await users.get_in_organization(
        session, organization_id=actor.organization_id, user_id=user_id
    )
    if user is None:
        raise ProblemError(404, "The employee does not exist.")
    return user


async def list_users(
    session: AsyncSession,
    actor: User,
    *,
    query: str | None,
    status: UserStatus | None,
    department_id: uuid.UUID | None,
    limit: int,
    cursor: str | None,
) -> Page[UserPublic]:
    rows = await users.list_page(
        session,
        organization_id=actor.organization_id,
        query=query,
        status=status,
        department_id=department_id,
        after_employee_code=decode_cursor(cursor) if cursor else None,
        limit=limit,
    )
    page = rows[:limit]
    has_more = len(rows) > limit
    return Page[UserPublic](
        items=[UserPublic.model_validate(user) for user in page],
        next_cursor=encode_cursor(page[-1].employee_code) if has_more else None,
    )


async def update_user(
    session: AsyncSession, actor: User, user_id: uuid.UUID, data: UserUpdate
) -> User:
    """Apply a partial update. The caller commits."""
    target = await get_user(session, actor, user_id)
    changes = data.model_dump(exclude_unset=True)
    touches_privileges = bool(_PRIVILEGE_FIELDS & changes.keys())

    if target.org_role == OrgRole.OWNER:
        # The owner is the root of trust: others cannot edit it, and it cannot demote itself.
        if actor.id != target.id:
            raise ProblemError(403, "The owner account cannot be changed by others.")
        if touches_privileges:
            raise ProblemError(403, "The owner's role, level and status cannot be changed.")
    elif actor.id == target.id and touches_privileges:
        raise ProblemError(409, "You cannot change your own role, level or status.")

    new_level = changes.get("level", target.level)
    new_role = changes.get("org_role", target.org_role)
    if touches_privileges:
        _check_level_matches_role(new_level, new_role)

    new_department = changes["department_id"] if "department_id" in changes else None
    new_manager = changes["manager_id"] if "manager_id" in changes else None
    await _validate_references(
        session,
        actor,
        department_id=new_department,
        manager_id=new_manager,
        target_id=target.id,
    )

    was_active = target.status == UserStatus.ACTIVE
    for field, value in changes.items():
        setattr(target, field, value)

    if was_active and target.status == UserStatus.DISABLED:
        # A disabled employee loses access at once: every open session is revoked.
        await auth_repository.revoke_all_for_user(session, user_id=target.id, now=datetime.now(UTC))
    await session.flush()
    return target
