import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class View(Base):
    """A person's own way of looking at a table: filter, sort and hidden columns."""

    __tablename__ = "views"
    __table_args__ = (
        Index("ix_views_owner_table", "owner_user_id", "table_id"),
        Index(
            "uq_views_table_owner_name",
            "table_id",
            "owner_user_id",
            text("lower(name)"),
            unique=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    table_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tables.id", ondelete="RESTRICT"))
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(100))
    # {"filter": [...], "sort": [...], "hidden_fields": [...]}. Never SQL: only field ids and
    # operators from a fixed list (docs/erd.md 3.7).
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
