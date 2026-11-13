import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import User
from app.modules.workspaces.models import Workspace, WorkspaceMember, WorkspaceRole


async def get_in_organization(
    session: AsyncSession, *, organization_id: uuid.UUID, workspace_id: uuid.UUID
) -> Workspace | None:
    """A live workspace of the organization (deleted ones are treated as missing)."""
    result = await session.execute(
        select(Workspace).where(
            Workspace.organization_id == organization_id,
            Workspace.id == workspace_id,
            Workspace.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def get_member_role(
    session: AsyncSession, *, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> WorkspaceRole | None:
    result = await session.execute(
        select(WorkspaceMember.role).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def list_for_member(
    session: AsyncSession, *, organization_id: uuid.UUID, user_id: uuid.UUID
) -> list[tuple[Workspace, WorkspaceRole]]:
    result = await session.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(
            Workspace.organization_id == organization_id,
            Workspace.deleted_at.is_(None),
            WorkspaceMember.user_id == user_id,
        )
        .order_by(Workspace.kind.desc(), Workspace.name)
    )
    return [(row[0], row[1]) for row in result.all()]


async def list_all(session: AsyncSession, *, organization_id: uuid.UUID) -> list[Workspace]:
    result = await session.execute(
        select(Workspace)
        .where(Workspace.organization_id == organization_id, Workspace.deleted_at.is_(None))
        .order_by(Workspace.kind.desc(), Workspace.name)
    )
    return list(result.scalars())


async def list_members(
    session: AsyncSession, *, workspace_id: uuid.UUID
) -> list[tuple[WorkspaceMember, User]]:
    result = await session.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(User.employee_code)
    )
    return [(row[0], row[1]) for row in result.all()]


async def get_member(
    session: AsyncSession, *, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> WorkspaceMember | None:
    return await session.get(WorkspaceMember, (workspace_id, user_id))


def add(session: AsyncSession, item: Workspace | WorkspaceMember) -> None:
    session.add(item)


async def delete_member(session: AsyncSession, member: WorkspaceMember) -> None:
    await session.delete(member)
