import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class OrgRole(enum.StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class UserLevel(enum.StrEnum):
    """Business level (cap bac). It does not grant visibility of records by itself."""

    ADMIN = "admin"
    DIVISION_MANAGER = "division_manager"
    DEPARTMENT_MANAGER = "department_manager"
    EMPLOYEE = "employee"


class UserStatus(enum.StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class User(Base):
    """An employee and, at the same time, the login account (see docs/erd.md)."""

    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "employee_code", name="uq_users_organization_id_employee_code"
        ),
        CheckConstraint("manager_id <> id", name="no_self_manager"),
        Index("ix_users_department_id", "department_id"),
        Index("ix_users_manager_id", "manager_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    employee_code: Mapped[str] = mapped_column(String(50))
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    org_role: Mapped[OrgRole] = mapped_column(str_enum(OrgRole, "org_role"))
    level: Mapped[UserLevel] = mapped_column(str_enum(UserLevel, "level"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT")
    )
    manager_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    status: Mapped[UserStatus] = mapped_column(
        str_enum(UserStatus, "status"), default=UserStatus.ACTIVE, server_default="active"
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
