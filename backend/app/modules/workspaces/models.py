import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class WorkspaceKind(enum.StrEnum):
    SHARED = "shared"
    PERSONAL = "personal"


class WorkspaceRole(enum.StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    COMMENTER = "commenter"
    VIEWER = "viewer"


class Workspace(Base):
    """A shared workspace, or the personal workspace every employee gets automatically."""

    __tablename__ = "workspaces"
    __table_args__ = (
        # A personal workspace always has an owner, a shared one never has.
        CheckConstraint(
            "(kind = 'personal' AND owner_user_id IS NOT NULL)"
            " OR (kind = 'shared' AND owner_user_id IS NULL)",
            name="kind_matches_owner",
        ),
        # At most one personal workspace per employee.
        Index(
            "uq_workspaces_personal_owner",
            "owner_user_id",
            unique=True,
            postgresql_where=text("kind = 'personal'"),
        ),
        Index("ix_workspaces_organization_id", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[WorkspaceKind] = mapped_column(str_enum(WorkspaceKind, "workspace_kind"))
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (Index("ix_workspace_members_user_id", "user_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[WorkspaceRole] = mapped_column(str_enum(WorkspaceRole, "workspace_role"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
