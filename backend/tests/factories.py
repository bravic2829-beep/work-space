import functools
import uuid

from sqlalchemy import select

from app.core.db import create_engine, create_sessionmaker
from app.core.security import hash_password as _hash_password
from app.modules.organizations.models import Organization
from app.modules.users.models import OrgRole, User, UserLevel, UserStatus
from app.modules.workspaces.service import create_personal_workspace

PASSWORD = "Password-123"


@functools.cache
def hash_password(password: str) -> str:
    """argon2id is slow on purpose, so hash each test password only once per test run."""
    return _hash_password(password)


async def create_user(
    database_url: str,
    *,
    employee_code: str = "E001",
    password: str = PASSWORD,
    full_name: str = "Test User",
    level: UserLevel = UserLevel.EMPLOYEE,
    org_role: OrgRole = OrgRole.MEMBER,
    status: UserStatus = UserStatus.ACTIVE,
    department_id: uuid.UUID | None = None,
    manager_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Insert a user straight into the database (the organization is created when missing).

    Also creates the personal workspace, as the HR endpoint does.
    """
    engine = create_engine(database_url)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            organization = (
                await session.execute(select(Organization).limit(1))
            ).scalar_one_or_none()
            if organization is None:
                organization = Organization(name="Acme")
                session.add(organization)
                await session.flush()
            user = User(
                organization_id=organization.id,
                employee_code=employee_code,
                full_name=full_name,
                password_hash=hash_password(password),
                org_role=org_role,
                level=level,
                status=status,
                department_id=department_id,
                manager_id=manager_id,
            )
            session.add(user)
            await session.flush()
            # Like an account created by an admin, it comes with a personal workspace.
            await create_personal_workspace(session, user)
            return user.id
    finally:
        await engine.dispose()


async def create_other_organization(database_url: str) -> dict[str, uuid.UUID]:
    """A second organization with a department and an employee, to test tenant isolation."""
    from app.modules.organizations.models import Department, DepartmentKind

    engine = create_engine(database_url)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            organization = Organization(name="Other company")
            session.add(organization)
            await session.flush()
            department = Department(
                organization_id=organization.id, name="Other division", kind=DepartmentKind.DIVISION
            )
            user = User(
                organization_id=organization.id,
                employee_code="OTHER1",
                full_name="Someone Else",
                password_hash=hash_password(PASSWORD),
                org_role=OrgRole.ADMIN,
                level=UserLevel.ADMIN,
            )
            session.add_all([department, user])
            await session.flush()
            return {
                "organization_id": organization.id,
                "department_id": department.id,
                "user_id": user.id,
            }
    finally:
        await engine.dispose()


async def session_for_user(database_url: str, user_id: uuid.UUID) -> dict[str, str]:
    """A Cookie header for a user, made without the login endpoint.

    The login endpoint only knows the first organization (this is a one-company product), so a
    user of a second organization, created to test tenant isolation, cannot sign in. The token is
    made exactly like a login does: a row in `auth_sessions` and a signed JWT pointing at it.
    """
    from datetime import UTC, datetime, timedelta

    from app.core.config import Settings
    from app.modules.auth.models import AuthSession
    from app.modules.auth.tokens import encode_token
    from tests.api_helpers import with_cookie
    from tests.helpers import TEST_JWT_SECRET

    settings = Settings(_env_file=None, app_env="test", jwt_secret=TEST_JWT_SECRET)
    now = datetime.now(UTC)
    engine = create_engine(database_url)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            auth_session = AuthSession(
                id=uuid.uuid4(),
                user_id=user_id,
                remember_me=False,
                expires_at=now + timedelta(hours=1),
            )
            session.add(auth_session)
            await session.flush()
            token = encode_token(
                settings,
                user_id=user_id,
                session_id=auth_session.id,
                issued_at=now,
                expires_at=auth_session.expires_at,
            )
    finally:
        await engine.dispose()
    return with_cookie(token)
