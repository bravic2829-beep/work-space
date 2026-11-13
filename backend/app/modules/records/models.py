import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class Record(Base):
    """One row of a table. `data` maps field id -> value (ADR 0002)."""

    __tablename__ = "records"
    __table_args__ = (
        # The list of a table, newest last, without the trash.
        Index(
            "ix_records_table_live",
            "table_id",
            "created_at",
            "id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # The job that empties the trash looks at deleted rows only.
        Index(
            "ix_records_deleted_at", "deleted_at", postgresql_where=text("deleted_at IS NOT NULL")
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    table_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tables.id", ondelete="RESTRICT"))
    data: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Goes up with every change. Clients send it back (If-Match) to avoid overwriting others.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )


class ViewerReason(enum.StrEnum):
    CREATOR = "creator"
    FIELD = "field"


CREATOR_SOURCE = "creator"


class RecordViewer(Base):
    """ "Who sees which record", kept in step with `records.data` (ADR 0003).

    Only `records.visibility` writes here. A person can be a viewer for several reasons
    (creator and assignee), so the source is part of the key.
    """

    __tablename__ = "record_viewers"
    __table_args__ = (Index("ix_record_viewers_user_record", "user_id", "record_id"),)

    record_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # "creator", or the id of the user field that named this person.
    source_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    reason: Mapped[ViewerReason] = mapped_column(str_enum(ViewerReason, "viewer_reason"))
    source_field_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fields.id", ondelete="RESTRICT")
    )


class RecordLink(Base):
    """One direction of a link between two records. A link is stored twice (both directions)."""

    __tablename__ = "record_links"
    __table_args__ = (Index("ix_record_links_target", "target_record_id"),)

    field_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("fields.id", ondelete="RESTRICT"), primary_key=True
    )
    source_record_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    target_record_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
