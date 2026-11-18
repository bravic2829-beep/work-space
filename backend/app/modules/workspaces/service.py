import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import FORBIDDEN, ProblemError
from app.modules.permissions.service import is_org_admin, require_workspace_role
from app.modules.users import repository as users
from app.modules.users.models import User, UserStatus
from app.modules.workspaces import repository
from app.modules.workspaces.models import (
    Workspace,
    WorkspaceKind,
    WorkspaceMember,
    WorkspaceRole,
)
from app.modules.workspaces.schemas import (
    MemberCreate,
    MemberPublic,
    MemberUpdate,
    WorkspacePublic,
)

PERSONAL_WORKSPACE_NAME = "Personal"


def _public(workspace: Workspace, role: WorkspaceRole) -> WorkspacePublic:
    return WorkspacePublic(
        id=workspace.id,
        name=workspace.name,
        kind=workspace.kind,
        owner_user_id=workspace.owner_user_id,
        my_role=role,
    )


def _member_public(user: User, role: WorkspaceRole) -> MemberPublic:
    return MemberPublic(
        user_id=user.id,
        employee_code=user.employee_code,
        full_name=user.full_name,
        role=role,
        is_org_admin=is_org_admin(user),
    )


async def create_personal_workspace(session: AsyncSession, user: User) -> Workspace:
    """Every employee gets one personal workspace, in the same transaction as the account."""
    workspace = Workspace(
        organization_id=user.organization_id,
        name=PERSONAL_WORKSPACE_NAME,
        kind=WorkspaceKind.PERSONAL,
        owner_user_id=user.id,
    )
    session.add(workspace)
    await session.flush()
    session.add(
        WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.ADMIN)
    )
    await session.flush()
    return workspace


async def list_workspaces(
    session: AsyncSession, actor: User, scope: Literal["member", "all"]
) -> list[WorkspacePublic]:
    """`member`: workspaces the user belongs to. `all`: every workspace (organization admins)."""
    if scope == "all":
        if not is_org_admin(actor):
            raise ProblemError(403, FORBIDDEN)
        everything = await repository.list_all(session, organization_id=actor.organization_id)
        return [_public(workspace, WorkspaceRole.ADMIN) for workspace in everything]

    mine = await repository.list_for_member(
        session, organization_id=actor.organization_id, user_id=actor.id
    )
    return [
        _public(workspace, WorkspaceRole.ADMIN if is_org_admin(actor) else role)
        for workspace, role in mine
    ]


async def create_workspace(session: AsyncSession, actor: User, name: str) -> WorkspacePublic:
    """Shared workspaces are created by organization admins, who become their first member."""
    if not is_org_admin(actor):
        raise ProblemError(403, FORBIDDEN)
    workspace = Workspace(
        organization_id=actor.organization_id, name=name, kind=WorkspaceKind.SHARED
    )
    repository.add(session, workspace)
    await session.flush()
    repository.add(
        session,
        WorkspaceMember(workspace_id=workspace.id, user_id=actor.id, role=WorkspaceRole.ADMIN),
    )
    await session.flush()
    return _public(workspace, WorkspaceRole.ADMIN)


async def get_workspace(
    session: AsyncSession, actor: User, workspace_id: uuid.UUID
) -> WorkspacePublic:
    workspace, role = await require_workspace_role(session, actor, workspace_id)
    return _public(workspace, role)


async def rename_workspace(
    session: AsyncSession, actor: User, workspace_id: uuid.UUID, name: str
) -> WorkspacePublic:
    workspace, role = await require_workspace_role(
        session, actor, workspace_id, WorkspaceRole.ADMIN
    )
    workspace.name = name
    await session.flush()
    return _public(workspace, role)


async def delete_workspace(session: AsyncSession, actor: User, workspace_id: uuid.UUID) -> None:
    """Soft delete: the workspace disappears but its data is kept."""
    workspace, _ = await require_workspace_role(session, actor, workspace_id, WorkspaceRole.ADMIN)
    if workspace.kind == WorkspaceKind.PERSONAL:
        raise ProblemError(409, "A personal workspace cannot be deleted.")
    workspace.deleted_at = datetime.now(UTC)
    await session.flush()


def _refuse_personal(workspace: Workspace) -> None:
    if workspace.kind == WorkspaceKind.PERSONAL:
        raise ProblemError(409, "The members of a personal workspace cannot be changed.")


async def list_members(
    session: AsyncSession, actor: User, workspace_id: uuid.UUID
) -> list[MemberPublic]:
    await require_workspace_role(session, actor, workspace_id)
    rows = await repository.list_members(session, workspace_id=workspace_id)
    return [_member_public(user, member.role) for member, user in rows]


async def add_member(
    session: AsyncSession, actor: User, workspace_id: uuid.UUID, data: MemberCreate
) -> MemberPublic:
    workspace, _ = await require_workspace_role(session, actor, workspace_id, WorkspaceRole.ADMIN)
    _refuse_personal(workspace)

    user = await users.get_in_organization(
        session, organization_id=actor.organization_id, user_id=data.user_id
    )
    if user is None or user.status != UserStatus.ACTIVE:
        raise ProblemError(422, "The employee does not exist or is disabled.")
    if await repository.get_member(session, workspace_id=workspace.id, user_id=user.id):
        raise ProblemError(409, "The employee is already a member of this workspace.")

    repository.add(
        session, WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=data.role)
    )
    await session.flush()
    return _member_public(user, data.role)


async def _get_member_or_404(
    session: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> WorkspaceMember:
    member = await repository.get_member(session, workspace_id=workspace_id, user_id=user_id)
    if member is None:
        raise ProblemError(404, "This employee is not a member of the workspace.")
    return member


async def update_member(
    session: AsyncSession,
    actor: User,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    data: MemberUpdate,
) -> MemberPublic:
    workspace, _ = await require_workspace_role(session, actor, workspace_id, WorkspaceRole.ADMIN)
    _refuse_personal(workspace)
    member = await _get_member_or_404(session, workspace.id, user_id)
    user = await users.get_in_organization(
        session, organization_id=actor.organization_id, user_id=user_id
    )
    assert user is not None  # a member always belongs to the organization of the workspace
    member.role = data.role
    await session.flush()
    return _member_public(user, data.role)


async def remove_member(
    session: AsyncSession, actor: User, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    workspace, _ = await require_workspace_role(session, actor, workspace_id, WorkspaceRole.ADMIN)
    _refuse_personal(workspace)
    member = await _get_member_or_404(session, workspace.id, user_id)
    await repository.delete_member(session, member)
    await session.flush()
