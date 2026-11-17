import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.models import AuthSession
from app.modules.users.models import User, UserStatus


def add(session: AsyncSession, auth_session: AuthSession) -> None:
    session.add(auth_session)


async def get_valid_with_user(
    session: AsyncSession, *, session_id: uuid.UUID, user_id: uuid.UUID, now: datetime
) -> tuple[AuthSession, User] | None:
    """The session and its user, only if it is not revoked, not expired and the user is active."""
    result = await session.execute(
        select(AuthSession, User)
        .join(User, User.id == AuthSession.user_id)
        .where(
            AuthSession.id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
            User.status == UserStatus.ACTIVE,
        )
    )
    row = result.first()
    return (row[0], row[1]) if row else None


async def revoke(session: AsyncSession, *, session_id: uuid.UUID, now: datetime) -> None:
    await session.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def revoke_others_for_user(
    session: AsyncSession, *, user_id: uuid.UUID, keep_session_id: uuid.UUID, now: datetime
) -> None:
    """Sign the person out everywhere except the session they are using now."""
    await session.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == user_id,
            AuthSession.id != keep_session_id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )


async def revoke_all_for_user(session: AsyncSession, *, user_id: uuid.UUID, now: datetime) -> None:
    await session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
