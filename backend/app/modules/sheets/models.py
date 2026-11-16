"""Sheets: a person's own view of the work, with its own list of who may do what.

A sheet belongs to one task table and to one person (its owner). It shows the records of that
table that name the owner in the assignee column, so the sheet and the table are the same data.
Who may open and change the sheet is decided here, per sheet, and not by the workspace.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class SheetRole(enum.StrEnum):
    """What a member may do on a sheet, from least to most."""

    VIEWER = "viewer"
    COMMENTER = "commenter"
    EDITOR = "editor"
    MANAGER = "manager"


SHEET_RANK = {
    SheetRole.VIEWER: 0,
    SheetRole.COMMENTER: 1,
    SheetRole.EDITOR: 2,
    SheetRole.MANAGER: 3,
}


class Sheet(Base):
    __tablename__ = "sheets"
    __table_args__ = (
        Index("ix_sheets_table_id", "table_id"),
        # One live sheet per person and table.
        Index(
            "uq_sheets_table_owner",
            "table_id",
            "owner_id",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    table_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tables.id", ondelete="CASCADE"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(200))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SheetMember(Base):
    __tablename__ = "sheet_members"
    __table_args__ = (Index("ix_sheet_members_user_id", "user_id"),)

    sheet_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sheets.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[SheetRole] = mapped_column(str_enum(SheetRole, "sheet_role"))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
