import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ProblemError
from app.core.security import (
    hash_password,
    hash_password_async,
    needs_rehash,
    verify_password_async,
)
from app.modules.auth import repository
from app.modules.auth.models import AuthSession
from app.modules.auth.rate_limiter import LoginFailureLimiter
from app.modules.auth.tokens import decode_token, encode_token
from app.modules.organizations import repository as organizations
from app.modules.users import repository as users
from app.modules.users.models import User, UserStatus

UNAUTHENTICATED_HEADERS = {"WWW-Authenticate": 'Cookie realm="workbase"'}

# Verified when the employee code does not exist, so a wrong code takes as long as a wrong
# password and the response time does not reveal which codes are real.
_DUMMY_HASH = hash_password("a-password-nobody-has")


def unauthenticated() -> ProblemError:
    return ProblemError(401, "Authentication is required.", headers=UNAUTHENTICATED_HEADERS)


@dataclass(frozen=True)
class LoginResult:
    user: User
    token: str
    max_age_seconds: int


@dataclass(frozen=True)
class AuthContext:
    user: User
    session_id: uuid.UUID


async def login(
    session: AsyncSession,
    settings: Settings,
    limiter: LoginFailureLimiter,
    *,
    employee_code: str,
    password: str,
    remember_me: bool,
    now: datetime | None = None,
) -> LoginResult:
    """Check the credentials and open a session. The caller commits."""
    now = now or datetime.now(UTC)

    retry_after = limiter.retry_after_seconds(employee_code)
    if retry_after is not None:
        raise ProblemError(
            429,
            "Too many failed login attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    organization = await organizations.get_first(session)
    user = (
        await users.get_by_employee_code(
            session, organization_id=organization.id, employee_code=employee_code.strip()
        )
        if organization
        else None
    )

    password_ok = await verify_password_async(user.password_hash if user else _DUMMY_HASH, password)
    if user is None or not password_ok or user.status != UserStatus.ACTIVE:
        limiter.record_failure(employee_code)
        # One message for a wrong code, a wrong password and a disabled account.
        raise ProblemError(
            401, "Invalid employee code or password.", headers=UNAUTHENTICATED_HEADERS
        )

    limiter.reset(employee_code)
    if needs_rehash(user.password_hash):
        user.password_hash = await hash_password_async(password)

    lifetime = (
        timedelta(days=settings.remember_me_days)
        if remember_me
        else timedelta(hours=settings.session_hours)
    )
    auth_session = AuthSession(
        id=uuid.uuid4(), user_id=user.id, remember_me=remember_me, expires_at=now + lifetime
    )
    repository.add(session, auth_session)
    await session.flush()

    token = encode_token(
        settings,
        user_id=user.id,
        session_id=auth_session.id,
        issued_at=now,
        expires_at=auth_session.expires_at,
    )
    return LoginResult(user=user, token=token, max_age_seconds=int(lifetime.total_seconds()))


async def authenticate(
    session: AsyncSession, settings: Settings, token: str, now: datetime | None = None
) -> AuthContext | None:
    """The signed-in user for a token, or None when the token is not (or no longer) valid."""
    claims = decode_token(settings, token)
    if claims is None:
        return None
    found = await repository.get_valid_with_user(
        session,
        session_id=claims.session_id,
        user_id=claims.user_id,
        now=now or datetime.now(UTC),
    )
    if found is None:
        return None
    return AuthContext(user=found[1], session_id=found[0].id)


async def logout(
    session: AsyncSession, *, session_id: uuid.UUID, now: datetime | None = None
) -> None:
    """Revoke the session, so the token stops working immediately. The caller commits."""
    await repository.revoke(session, session_id=session_id, now=now or datetime.now(UTC))
