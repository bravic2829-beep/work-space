"""Making, listing and reading notifications."""

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.core.pagination import Page, check_limit, parse_time_cursor, time_cursor
from app.modules.fields import repository as fields_repo
from app.modules.fields.models import Field, FieldAccessLevel
from app.modules.fields.titles import title_field, title_of
from app.modules.notifications import realtime, repository
from app.modules.notifications.models import Notification, NotificationType
from app.modules.notifications.schemas import (
    NotificationActor,
    NotificationPublic,
    NotificationUpdate,
    UnreadCount,
)
from app.modules.records.models import Record
from app.modules.users.models import User


async def notify(
    session: AsyncSession,
    kind: NotificationType,
    actor: User,
    record: Record,
    fields: list[Field],
    recipient_ids: set[uuid.UUID],
) -> None:
    """Tell people about something `actor` did to a task. Nobody is told about their own action.

    The task name is copied into the notification only for a recipient who may see that column:
    a hidden column must not leak through a notification.
    """
    recipients = sorted(recipient_ids - {actor.id}, key=str)
    if not recipients:
        return
    title = title_field(fields)
    name = title_of(fields, record.data)
    for user_id in recipients:
        shown = name
        if title is not None and name is not None:
            overrides = await fields_repo.get_access_overrides(
                session, user_id=user_id, table_id=record.table_id
            )
            if overrides.get(title.id) == FieldAccessLevel.HIDDEN:
                shown = None
        session.add(
            Notification(
                user_id=user_id,
                type=kind,
                actor_user_id=actor.id,
                record_id=record.id,
                payload={"record_name": shown},
            )
        )
    await session.flush()
    realtime.announce_after_commit(session.sync_session, set(recipients))


async def notify_task_assigned(
    session: AsyncSession,
    actor: User,
    record: Record,
    fields: list[Field],
    recipient_ids: set[uuid.UUID],
) -> None:
    await notify(session, NotificationType.TASK_ASSIGNED, actor, record, fields, recipient_ids)


def _public(row: repository.Row) -> NotificationPublic:
    notification, table_id, actor = row
    return NotificationPublic(
        id=notification.id,
        type=notification.type,
        record_id=notification.record_id,
        table_id=table_id,
        record_name=notification.payload.get("record_name"),
        actor=NotificationActor(id=actor.id, full_name=actor.full_name),
        read_at=notification.read_at,
        created_at=notification.created_at,
    )


async def list_notifications(
    session: AsyncSession,
    actor: User,
    *,
    limit: int,
    cursor: str | None,
    unread_only: bool,
) -> Page[NotificationPublic]:
    check_limit(limit)
    rows = await repository.list_page(
        session,
        user_id=actor.id,
        limit=limit + 1,
        after=parse_time_cursor(cursor),
        unread_only=unread_only,
    )
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if more:
        last = rows[-1][0]
        next_cursor = time_cursor(last.created_at, last.id)
    return Page[NotificationPublic](items=[_public(r) for r in rows], next_cursor=next_cursor)


async def unread_count(session: AsyncSession, actor: User) -> UnreadCount:
    return UnreadCount(unread=await repository.count_unread(session, user_id=actor.id))


async def update_notification(
    session: AsyncSession, actor: User, notification_id: uuid.UUID, data: NotificationUpdate
) -> NotificationPublic:
    row = await repository.get_own(session, user_id=actor.id, notification_id=notification_id)
    if row is None:
        raise ProblemError(404, "The notification does not exist.")
    notification = row[0]
    if data.read and notification.read_at is None:
        notification.read_at = datetime.now(UTC)
    elif not data.read:
        notification.read_at = None
    await session.flush()
    return _public(row)


async def mark_all_read(session: AsyncSession, actor: User) -> UnreadCount:
    """Mark all my notifications read. Returns the new unread count (zero)."""
    await repository.mark_all_read(session, user_id=actor.id, when=datetime.now(UTC))
    await session.flush()
    return await unread_count(session, actor)
