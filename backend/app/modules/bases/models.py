import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WorkBase(Base):
    """A base groups tables inside a workspace. (Named WorkBase to not clash with `Base`.)"""

    __tablename__ = "bases"
    __table_args__ = (
        Index("ix_bases_workspace_id", "workspace_id"),
        # Two live bases of a workspace cannot have the same name (case-insensitive).
        Index(
            "uq_bases_workspace_name",
            "workspace_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(200))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Table(Base):
    __tablename__ = "tables"
    __table_args__ = (
        Index("ix_tables_base_id", "base_id"),
        Index(
            "uq_tables_base_name",
            "base_id",
            text("lower(name)"),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    base_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bases.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(200))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
