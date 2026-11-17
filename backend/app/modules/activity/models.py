"""The history of a task: who did what, and when.

One row per thing that happened. `changes` holds the cells that changed, keyed by column id,
each as {"from": old, "to": new}. It is read back for one task at a time (by `record_id`), never
searched inside, so a JSONB column is enough; columns the reader may not see are left out when it
is read (activity.service), exactly like the task itself.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class ActivityAction(enum.StrEnum):
    CREATED = "created"
    UPDATED = "updated"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    SENT_BACK = "sent_back"
    TIMER_STARTED = "timer_started"
    TIMER_STOPPED = "timer_stopped"
    HANDED_OVER = "handed_over"
    ATTACHMENT_ADDED = "attachment_added"
    ATTACHMENT_REMOVED = "attachment_removed"


class ActivityEntry(Base):
    __tablename__ = "activity_log"
    __table_args__ = (Index("ix_activity_log_record_created", "record_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    record_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    action: Mapped[ActivityAction] = mapped_column(str_enum(ActivityAction, "activity_action"))
    changes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    # A reason (sent back) or the result of the work (handed over). Free text, shown as text.
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Handover(Base):
    """A task passed from one person to another, with what was done and the documents."""

    __tablename__ = "handovers"
    __table_args__ = (Index("ix_handovers_record_id", "record_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    record_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"))
    from_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    to_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    result: Mapped[str] = mapped_column(Text)
    documents: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
