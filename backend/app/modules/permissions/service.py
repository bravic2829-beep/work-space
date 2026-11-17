"""Object-level permission helpers. The backend is the only source of truth for access.

Workspaces, bases and tables inherit the role of the workspace. Who can see a record, and
what a person may do with a column, is decided here too (see docs/usecases.md section 3.1).
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import FORBIDDEN, ProblemError
from app.modules.bases import repository as bases
from app.modules.bases.models import Table, WorkBase
from app.modules.records.models import Record, RecordViewer
from app.modules.sheets.access import has_sheet_on_table
from app.modules.users.models import OrgRole, User
from app.modules.workspaces import repository as workspaces
from app.modules.workspaces.models import Workspace, WorkspaceRole

_ROLE_RANK = {
    WorkspaceRole.VIEWER: 0,
    WorkspaceRole.COMMENTER: 1,
    WorkspaceRole.EDITOR: 2,
    WorkspaceRole.ADMIN: 3,
}


def role_at_least(role: WorkspaceRole, minimum: WorkspaceRole) -> bool:
    return _ROLE_RANK[role] >= _ROLE_RANK[minimum]


def is_org_admin(user: User) -> bool:
    """Organization owners and admins can see and manage everything in their organization."""
    return user.org_role in (OrgRole.OWNER, OrgRole.ADMIN)


async def workspace_role(
    session: AsyncSession, user: User, workspace: Workspace
) -> WorkspaceRole | None:
    """The role the user has in the workspace, or None when they have no access at all."""
    if workspace.organization_id != user.organization_id:
        return None
    if is_org_admin(user):
        return WorkspaceRole.ADMIN
    return await workspaces.get_member_role(session, workspace_id=workspace.id, user_id=user.id)


async def require_workspace_role(
    session: AsyncSession,
    user: User,
    workspace_id: uuid.UUID,
    minimum: WorkspaceRole = WorkspaceRole.VIEWER,
) -> tuple[Workspace, WorkspaceRole]:
    """Load a workspace and check the user's role.

    404 when the workspace does not exist for this organization (this also covers a workspace
    of another company), 403 when it exists but the user's role is not enough.
    """
    workspace = await workspaces.get_in_organization(
        session, organization_id=user.organization_id, workspace_id=workspace_id
    )
    if workspace is None:
        raise ProblemError(404, "The workspace does not exist.")
    role = await workspace_role(session, user, workspace)
    if role is None or not role_at_least(role, minimum):
        raise ProblemError(403, FORBIDDEN)
    return workspace, role


async def require_base_role(
    session: AsyncSession,
    user: User,
    base_id: uuid.UUID,
    minimum: WorkspaceRole = WorkspaceRole.VIEWER,
) -> tuple[WorkBase, Workspace, WorkspaceRole]:
    """Load a base and check the user's role in its workspace (404, then 403)."""
    found = await bases.get_base(session, organization_id=user.organization_id, base_id=base_id)
    if found is None:
        raise ProblemError(404, "The base does not exist.")
    base, workspace = found
    role = await workspace_role(session, user, workspace)
    if role is None or not role_at_least(role, minimum):
        raise ProblemError(403, FORBIDDEN)
    return base, workspace, role


@dataclass(frozen=True)
class TableContext:
    """A table with its base and workspace, and the caller's workspace role (None: no role)."""

    table: Table
    base: WorkBase
    workspace: Workspace
    role: WorkspaceRole | None

    @property
    def can_edit(self) -> bool:
        return self.role is not None and role_at_least(self.role, WorkspaceRole.EDITOR)


async def load_table_context(
    session: AsyncSession, user: User, table_id: uuid.UUID
) -> TableContext:
    """404 when the table does not exist for this organization. The role may still be None."""
    found = await bases.get_table(session, organization_id=user.organization_id, table_id=table_id)
    if found is None:
        raise ProblemError(404, "The table does not exist.")
    table, base, workspace = found
    return TableContext(
        table=table,
        base=base,
        workspace=workspace,
        role=await workspace_role(session, user, workspace),
    )


async def require_table_role(
    session: AsyncSession,
    user: User,
    table_id: uuid.UUID,
    minimum: WorkspaceRole = WorkspaceRole.VIEWER,
) -> TableContext:
    """The user needs at least this role in the workspace of the table (404, then 403)."""
    context = await load_table_context(session, user, table_id)
    if context.role is None or not role_at_least(context.role, minimum):
        raise ProblemError(403, FORBIDDEN)
    return context


async def has_visible_records(session: AsyncSession, user: User, table_id: uuid.UUID) -> bool:
    """Does the person see at least one live record of the table through `record_viewers`?"""
    result = await session.execute(
        select(
            exists().where(
                RecordViewer.user_id == user.id,
                RecordViewer.record_id == Record.id,
                Record.table_id == table_id,
                Record.deleted_at.is_(None),
            )
        )
    )
    return bool(result.scalar_one())


async def require_table_read(
    session: AsyncSession, user: User, table_id: uuid.UUID
) -> TableContext:
    """Reading a table: a workspace role, or at least one record that is visible to the person.

    Somebody who was only given a task (not added to the workspace) can open the table to see
    that task, but only the records and the columns they may see.
    """
    context = await load_table_context(session, user, table_id)
    if (
        context.role is None
        and not await has_visible_records(session, user, table_id)
        and not await has_sheet_on_table(session, user, table_id)
    ):
        raise ProblemError(403, FORBIDDEN)
    return context


async def can_view_record(
    session: AsyncSession, user: User, context: TableContext, record: Record
) -> bool:
    """The rule of docs/usecases.md 3.1.

    Organization admins and members of the workspace see every record of its tables.
    Everybody else sees the records they created and the records that name them in a user
    field that grants view access, which is what `record_viewers` holds.
    """
    if record.table_id != context.table.id:
        return False
    if context.role is not None:
        return True
    result = await session.execute(
        select(exists().where(RecordViewer.record_id == record.id, RecordViewer.user_id == user.id))
    )
    return bool(result.scalar_one())
