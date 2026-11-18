"""Files attached to a task, in a column of the type "attachment".

Only the facts about the file are in the database. The bytes are on disk under the name
`storage_key` (a random id), never under the name the person gave, so a file name can never
choose where it is written.
"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (Index("ix_attachments_record_field", "record_id", "field_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    record_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"))
    field_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fields.id", ondelete="RESTRICT"))
    # The name the person sees and gets back when downloading (cleaned, no path).
    name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TrashedAttachment(Base):
    """A removed file keeps its origin IDs even if the task or column is later deleted."""

    __tablename__ = "trashed_attachments"
    __table_args__ = (
        Index("ix_trashed_attachments_org_deleted", "organization_id", "deleted_at", "id"),
        Index("ix_trashed_attachments_purge", "purge_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    record_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    field_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(String(64), unique=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    purge_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
