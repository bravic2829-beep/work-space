import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class FieldType(enum.StrEnum):
    TEXT = "text"
    LONG_TEXT = "long_text"
    NUMBER = "number"
    DATE = "date"
    CHECKBOX = "checkbox"
    SINGLE_SELECT = "single_select"
    MULTI_SELECT = "multi_select"
    STATUS = "status"
    USER = "user"
    URL = "url"
    LINK_RECORD = "link_record"
    CREATED_BY = "created_by"
    CREATED_TIME = "created_time"
    AUTO_NUMBER = "auto_number"


class FieldSemantic(enum.StrEnum):
    """The business role of a field, so features like "Assigned to me" can find it."""

    ASSIGNEE = "assignee"
    FOLLOWER = "follower"
    STATUS = "status"
    DUE_DATE = "due_date"
    PARENT = "parent"
    SUBTASKS = "subtasks"


class Field(Base):
    __tablename__ = "fields"
    __table_args__ = (
        Index("ix_fields_table_id", "table_id"),
        Index(
            "uq_fields_table_name",
            "table_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        # One assignee field, one status field... per table.
        Index(
            "uq_fields_table_semantic",
            "table_id",
            "semantic",
            unique=True,
            postgresql_where=text("semantic IS NOT NULL AND deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    table_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tables.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[FieldType] = mapped_column(str_enum(FieldType, "field_type"))
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    semantic: Mapped[FieldSemantic | None] = mapped_column(
        str_enum(FieldSemantic, "field_semantic")
    )
    # Only for user fields: the people chosen in it can see the record (ADR 0003).
    grants_view: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # Next number of an auto_number field.
    counter: Mapped[int] = mapped_column(BigInteger, default=0, server_default=text("0"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class FieldAccessLevel(enum.StrEnum):
    HIDDEN = "hidden"
    READ = "read"
    EDIT = "edit"


class FieldAccess(Base):
    """A per-person override of what they can do with one column (docs/erd.md 3.6)."""

    __tablename__ = "field_access"
    __table_args__ = (Index("ix_field_access_user_id", "user_id"),)

    field_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("fields.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    access: Mapped[FieldAccessLevel] = mapped_column(
        str_enum(FieldAccessLevel, "field_access_level")
    )
