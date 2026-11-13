import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class DepartmentKind(enum.StrEnum):
    DIVISION = "division"
    DEPARTMENT = "department"


class Organization(Base):
    """One row today (single company). Kept so every table has a clear organization boundary."""

    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Department(Base):
    """Division or department. A tree through parent_id."""

    __tablename__ = "departments"
    __table_args__ = (
        CheckConstraint("parent_id <> id", name="no_self_parent"),
        Index("ix_departments_organization_id", "organization_id"),
        Index("ix_departments_parent_id", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[DepartmentKind] = mapped_column(str_enum(DepartmentKind, "department_kind"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
