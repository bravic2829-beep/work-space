"""Sheets: creating them, who is on them, and reading and writing the records they show.

A sheet shows the records of its table that name its owner in the assignee column. The records
are the table's own, so the table and every sheet always agree. Who may open a sheet is decided
by its member list (`sheet_members`); an organization admin, or the admin of the workspace of the
table, can open and manage every sheet of the table.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import FORBIDDEN, ProblemError
from app.core.pagination import Page
from app.modules.fields import repository as fields_repo
from app.modules.permissions.service import (
    TableContext,
    is_org_admin,
    load_table_context,
    role_at_least,
)
from app.modules.records import service as records
from app.modules.records import visibility
from app.modules.records.models import Record
from app.modules.records.repository import active_user_ids
from app.modules.records.schemas import RecordPublic
from app.modules.sheets.access import assignee_column
from app.modules.sheets.models import SHEET_RANK, Sheet, SheetMember, SheetRole
from app.modules.sheets.schemas import (
    MemberPublic,
    SheetCreate,
    SheetOwner,
    SheetPublic,
)
from app.modules.users.models import User
from app.modules.workspaces.models import WorkspaceRole


def _is_admin(actor: User, context: TableContext) -> bool:
    """May manage every sheet of the table: organization admins and the workspace's admins."""
    return is_org_admin(actor) or (
        context.role is not None and role_at_least(context.role, WorkspaceRole.ADMIN)
    )


async def _owner(session: AsyncSession, sheet: Sheet) -> User:
    return (await session.execute(select(User).where(User.id == sheet.owner_id))).scalar_one()


async def _member_role(session: AsyncSession, sheet: Sheet, user: User) -> SheetRole | None:
    return (
        await session.execute(
            select(SheetMember.role).where(
                SheetMember.sheet_id == sheet.id, SheetMember.user_id == user.id
            )
        )
    ).scalar_one_or_none()


async def _access(
    session: AsyncSession, actor: User, sheet_id: uuid.UUID, minimum: SheetRole = SheetRole.VIEWER
) -> tuple[Sheet, SheetRole, TableContext, bool]:
    """A live sheet the person may use at this level: (sheet, role, table context, is admin).

    404 when it does not exist in the organization, 403 when it does but the role is too low.
    """
    sheet = await session.get(Sheet, sheet_id)
    if (
        sheet is None
        or sheet.organization_id != actor.organization_id
        or sheet.archived_at is not None
    ):
        raise ProblemError(404, "The sheet does not exist.")
    context = await load_table_context(session, actor, sheet.table_id)
    admin = _is_admin(actor, context)
    role = SheetRole.MANAGER if admin else await _member_role(session, sheet, actor)
    if role is None or SHEET_RANK[role] < SHEET_RANK[minimum]:
        raise ProblemError(403, FORBIDDEN)
    return sheet, role, context, admin


async def _public(
    session: AsyncSession, actor: User, sheet: Sheet, cache: dict[uuid.UUID, TableContext]
) -> SheetPublic:
    context = cache.get(sheet.table_id)
    if context is None:
        context = cache[sheet.table_id] = await load_table_context(session, actor, sheet.table_id)
    admin = _is_admin(actor, context)
    role = SheetRole.MANAGER if admin else await _member_role(session, sheet, actor)
    owner = await _owner(session, sheet)
    count = (
        await session.execute(
            select(func.count()).select_from(SheetMember).where(SheetMember.sheet_id == sheet.id)
        )
    ).scalar_one()
    return SheetPublic(
        id=sheet.id,
        table_id=sheet.table_id,
        table_name=context.table.name,
        owner=SheetOwner(id=owner.id, full_name=owner.full_name, employee_code=owner.employee_code),
        name=sheet.name,
        my_role=role or SheetRole.VIEWER,
        is_admin=admin,
        can_see_all=context.role is not None,
        member_count=count,
    )


async def _rebuild(session: AsyncSession, sheet: Sheet) -> None:
    """Make `record_viewers` agree with the sheet's members for every record the sheet shows."""
    fields = await fields_repo.list_fields(session, table_id=sheet.table_id)
    column = assignee_column(fields)
    if column is None:
        return
    shown = (
        (
            await session.execute(
                select(Record).where(
                    Record.table_id == sheet.table_id,
                    Record.data.contains({str(column.id): [str(sheet.owner_id)]}),
                )
            )
        )
        .scalars()
        .all()
    )
    for record in shown:
        await visibility.rebuild_record(session, record, fields)


# --- the sheets ------------------------------------------------------------------------------


async def list_sheets(
    session: AsyncSession, actor: User, table_id: uuid.UUID | None
) -> list[SheetPublic]:
    """The live sheets the person may open: all of the organization for an admin."""
    query = select(Sheet).where(
        Sheet.organization_id == actor.organization_id, Sheet.archived_at.is_(None)
    )
    if table_id is not None:
        query = query.where(Sheet.table_id == table_id)
    if not is_org_admin(actor):
        query = query.join(SheetMember, SheetMember.sheet_id == Sheet.id).where(
            SheetMember.user_id == actor.id
        )
    sheets = (await session.execute(query.order_by(Sheet.name, Sheet.id))).scalars().all()
    cache: dict[uuid.UUID, TableContext] = {}
    return [await _public(session, actor, sheet, cache) for sheet in sheets]


async def _check_people(session: AsyncSession, actor: User, ids: list[uuid.UUID]) -> None:
    known = await active_user_ids(
        session, organization_id=actor.organization_id, ids=list(set(ids))
    )
    if not set(ids) <= known:
        raise ProblemError(422, "An employee does not exist or is disabled.")


async def create_sheet(
    session: AsyncSession, actor: User, table_id: uuid.UUID, data: SheetCreate
) -> SheetPublic:
    context = await load_table_context(session, actor, table_id)
    if not _is_admin(actor, context):
        raise ProblemError(403, FORBIDDEN)
    fields = await fields_repo.list_fields(session, table_id=table_id)
    if assignee_column(fields) is None:
        raise ProblemError(409, "The table has no assignee column, so it cannot have sheets.")
    await _check_people(session, actor, [data.owner_id, *[m.user_id for m in data.members]])

    taken = (
        await session.execute(
            select(Sheet.id).where(
                Sheet.table_id == table_id,
                Sheet.owner_id == data.owner_id,
                Sheet.archived_at.is_(None),
            )
        )
    ).first()
    if taken is not None:
        raise ProblemError(409, "This person already has a sheet in this table.")
    owner = (await session.execute(select(User).where(User.id == data.owner_id))).scalar_one()

    sheet = Sheet(
        organization_id=actor.organization_id,
        table_id=table_id,
        owner_id=owner.id,
        name=data.name or owner.full_name,
        created_by=actor.id,
    )
    session.add(sheet)
    try:
        await session.flush()
    except IntegrityError:
        raise ProblemError(409, "This person already has a sheet in this table.") from None

    roles: dict[uuid.UUID, SheetRole] = {m.user_id: m.role for m in data.members}
    # The owner always edits their own sheet; the person who made it manages it.
    roles[owner.id] = _at_least(roles.get(owner.id), SheetRole.EDITOR)
    if actor.id != owner.id and not is_org_admin(actor):
        roles[actor.id] = SheetRole.MANAGER
    for user_id, role in roles.items():
        session.add(SheetMember(sheet_id=sheet.id, user_id=user_id, role=role))
    await session.flush()
    await _rebuild(session, sheet)
    return await _public(session, actor, sheet, {})


def _at_least(role: SheetRole | None, minimum: SheetRole) -> SheetRole:
    if role is None or SHEET_RANK[role] < SHEET_RANK[minimum]:
        return minimum
    return role


async def get_sheet(session: AsyncSession, actor: User, sheet_id: uuid.UUID) -> SheetPublic:
    sheet, _, _, _ = await _access(session, actor, sheet_id)
    return await _public(session, actor, sheet, {})


async def rename_sheet(
    session: AsyncSession, actor: User, sheet_id: uuid.UUID, name: str
) -> SheetPublic:
    sheet, _, _, admin = await _access(session, actor, sheet_id)
    if not admin:
        raise ProblemError(403, FORBIDDEN)
    sheet.name = name
    await session.flush()
    return await _public(session, actor, sheet, {})


async def archive_sheet(session: AsyncSession, actor: User, sheet_id: uuid.UUID) -> None:
    """Take the sheet out of use. The tasks stay in the table; only the sheet's members lose the
    access it gave them."""
    sheet, _, _, admin = await _access(session, actor, sheet_id)
    if not admin:
        raise ProblemError(403, FORBIDDEN)
    sheet.archived_at = datetime.now(UTC)
    await session.flush()
    await _rebuild(session, sheet)


# --- the members -----------------------------------------------------------------------------


async def list_members(
    session: AsyncSession, actor: User, sheet_id: uuid.UUID
) -> list[MemberPublic]:
    sheet, _, _, _ = await _access(session, actor, sheet_id, SheetRole.MANAGER)
    rows = (
        await session.execute(
            select(SheetMember, User)
            .join(User, User.id == SheetMember.user_id)
            .where(SheetMember.sheet_id == sheet.id)
        )
    ).all()
    members = [
        MemberPublic(
            user_id=user.id,
            full_name=user.full_name,
            employee_code=user.employee_code,
            role=member.role,
            is_owner=user.id == sheet.owner_id,
        )
        for member, user in rows
    ]
    members.sort(key=lambda m: (not m.is_owner, -SHEET_RANK[m.role], m.full_name))
    return members


async def set_member(
    session: AsyncSession, actor: User, sheet_id: uuid.UUID, user_id: uuid.UUID, role: SheetRole
) -> MemberPublic:
    """Add a person or change their role. The owner always keeps at least the editor role."""
    sheet, _, _, _ = await _access(session, actor, sheet_id, SheetRole.MANAGER)
    await _check_people(session, actor, [user_id])
    if user_id == sheet.owner_id and SHEET_RANK[role] < SHEET_RANK[SheetRole.EDITOR]:
        raise ProblemError(422, "The owner of a sheet always edits it.")
    member = await session.get(SheetMember, (sheet.id, user_id))
    if member is None:
        session.add(SheetMember(sheet_id=sheet.id, user_id=user_id, role=role))
    else:
        member.role = role
    await session.flush()
    await _rebuild(session, sheet)
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one()
    return MemberPublic(
        user_id=user.id,
        full_name=user.full_name,
        employee_code=user.employee_code,
        role=role,
        is_owner=user.id == sheet.owner_id,
    )


async def remove_member(
    session: AsyncSession, actor: User, sheet_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    sheet, _, _, _ = await _access(session, actor, sheet_id, SheetRole.MANAGER)
    if user_id == sheet.owner_id:
        raise ProblemError(409, "The owner cannot be removed from their own sheet.")
    member = await session.get(SheetMember, (sheet.id, user_id))
    if member is None:
        raise ProblemError(404, "This person is not on the sheet.")
    await session.delete(member)
    await session.flush()
    await _rebuild(session, sheet)


# --- the records -----------------------------------------------------------------------------


async def list_sheet_records(
    session: AsyncSession,
    actor: User,
    sheet_id: uuid.UUID,
    *,
    limit: int,
    cursor: str | None,
    sort: list[str],
    filter_json: str | None,
) -> Page[RecordPublic]:
    """The records of the sheet: the table's records that name its owner as assignee."""
    sheet, _, context, _ = await _access(session, actor, sheet_id)
    fields = await fields_repo.list_fields(session, table_id=sheet.table_id)
    column = assignee_column(fields)
    if column is None:
        raise ProblemError(409, "The table has no assignee column.")
    return await records.list_in_context(
        session,
        actor,
        context,
        limit=limit,
        cursor=cursor,
        sort=sort,
        filter_json=filter_json,
        extra_filters=[Record.data.contains({str(column.id): [str(sheet.owner_id)]})],
    )


async def create_sheet_record(
    session: AsyncSession, actor: User, sheet_id: uuid.UUID, incoming: dict[str, Any]
) -> tuple[Record, RecordPublic]:
    """A new task on the sheet: its owner is the assignee, whatever the request says."""
    sheet, role, _, _ = await _access(session, actor, sheet_id, SheetRole.EDITOR)
    return await records.create_record(
        session,
        actor,
        sheet.table_id,
        incoming,
        sheet_owner=sheet.owner_id,
        sheet_role=role,
    )
