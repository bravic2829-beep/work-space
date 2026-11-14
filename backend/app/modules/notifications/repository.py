import uuid
from datetime import datetime

from sqlalchemy import ColumnElement, func, select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.models import Notification
from app.modules.records.models import Record
from app.modules.users.models import User

Row = tuple[Notification, uuid.UUID, User]


def _mine(user_id: uuid.UUID, *, unread_only: bool = False) -> list[ColumnElement[bool]]:
    """Conditions: my notifications about records that are not in the trash."""
    conditions = [Notification.user_id == user_id, Record.deleted_at.is_(None)]
    if unread_only:
        conditions.append(Notification.read_at.is_(None))
    return conditions


async def list_page(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    limit: int,
    after: tuple[datetime, uuid.UUID] | None,
    unread_only: bool,
) -> list[Row]:
    """Newest first. The caller passes `limit + 1` to learn whether there is another page."""
    query = (
        select(Notification, Record.table_id, User)
        .join(Record, Record.id == Notification.record_id)
        .join(User, User.id == Notification.actor_user_id)
        .where(*_mine(user_id, unread_only=unread_only))
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    if after is not None:
        query = query.where(tuple_(Notification.created_at, Notification.id) < tuple_(*after))
    return [(row[0], row[1], row[2]) for row in (await session.execute(query)).all()]


async def count_unread(session: AsyncSession, *, user_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(Notification)
        .join(Record, Record.id == Notification.record_id)
        .where(*_mine(user_id, unread_only=True))
    )
    return int(result.scalar_one())


async def get_own(
    session: AsyncSession, *, user_id: uuid.UUID, notification_id: uuid.UUID
) -> Row | None:
    """One of my own notifications. Somebody else's is the same as one that does not exist."""
    row = (
        await session.execute(
            select(Notification, Record.table_id, User)
            .join(Record, Record.id == Notification.record_id)
            .join(User, User.id == Notification.actor_user_id)
            .where(
                Notification.id == notification_id,
                Notification.user_id == user_id,
                Record.deleted_at.is_(None),
            )
            .with_for_update(of=Notification)
        )
    ).first()
    return None if row is None else (row[0], row[1], row[2])


async def mark_all_read(session: AsyncSession, *, user_id: uuid.UUID, when: datetime) -> None:
    """Mark every unread notification of mine read, in one statement. Only mine: the user id is
    part of the filter, so no one can touch another person's."""
    await session.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=when)
        .execution_options(synchronize_session=False)
    )
