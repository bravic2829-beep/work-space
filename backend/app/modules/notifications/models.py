import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class NotificationType(enum.StrEnum):
    TASK_ASSIGNED = "task_assigned"
    REVIEW_REQUESTED = "review_requested"
    # The reviewer sent the work back with a reason.
    CHANGES_REQUESTED = "changes_requested"
    # Somebody reported a blocker on a task (the reason is a comment on it).
    TASK_BLOCKED = "task_blocked"


class Notification(Base):
    """Something a person should know about, kept until they read it (docs/usecases.md 4.7).

    Written in the same transaction as the change that caused it, so a notification never exists
    for a change that was rolled back. Only the recipient can read it.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_created", "user_id", "created_at", "id"),
        Index(
            "ix_notifications_user_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    type: Mapped[NotificationType] = mapped_column(str_enum(NotificationType, "notification_type"))
    actor_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    record_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"))
    # What the message needs, copied when the notification is made: {"record_name": "..."}.
    # It is a snapshot, so renaming the task later does not change old notifications.
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
