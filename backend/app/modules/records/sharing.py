"""Who can see one record: the data behind the "Who can see this" panel of a task.

The answer repeats the rule of `permissions.can_view_record` (docs/usecases.md 3.1) in words a
person can read: the people named on the record (its creator and the people in user columns that
grant view access), and the members of the workspace, who see every record of its tables.
Organization admins see everything too, but they are not listed (they are not "on" the task).
A user column the caller may not see is left out, so this never names someone the caller could
not already find in the record.
"""

import uuid
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fields.models import Field, FieldAccessLevel, FieldSemantic
from app.modules.permissions.service import TableContext
from app.modules.records.models import Record, RecordViewer, ViewerReason
from app.modules.users.models import User
from app.modules.workspaces import repository as workspaces

Reason = Literal["creator", "assignee", "follower", "field", "sheet"]

_RANK: dict[Reason, int] = {"creator": 0, "assignee": 1, "follower": 2, "field": 3, "sheet": 4}


class ViewerPublic(BaseModel):
    user_id: uuid.UUID
    full_name: str
    employee_code: str
    # Why this person sees the task. Several when they are, for example, creator and assignee.
    reasons: list[Reason]
    # The user columns that name them (empty for the creator reason).
    field_names: list[str]


class RecordViewers(BaseModel):
    people: list[ViewerPublic]
    workspace_name: str
    # Members of the workspace (any role) see every record of the table as well.
    workspace_member_count: int


def _reason_of(field: Field) -> Reason:
    if field.semantic == FieldSemantic.ASSIGNEE:
        return "assignee"
    if field.semantic == FieldSemantic.FOLLOWER:
        return "follower"
    return "field"


async def build(
    session: AsyncSession,
    context: TableContext,
    record: Record,
    visible: list[tuple[Field, FieldAccessLevel]],
) -> RecordViewers:
    columns = {field.id: field for field, _ in visible}
    rows = (
        await session.execute(
            select(RecordViewer, User)
            .join(User, User.id == RecordViewer.user_id)
            .where(RecordViewer.record_id == record.id)
        )
    ).all()

    people: dict[uuid.UUID, ViewerPublic] = {}
    for viewer, user in rows:
        if viewer.reason == ViewerReason.CREATOR:
            reason: Reason = "creator"
            field_name: str | None = None
        elif viewer.reason == ViewerReason.SHEET:
            reason = "sheet"
            field_name = None
        else:
            column = columns.get(viewer.source_field_id) if viewer.source_field_id else None
            if column is None:
                continue  # a column this person may not see: do not reveal who it names
            reason = _reason_of(column)
            field_name = column.name
        entry = people.setdefault(
            user.id,
            ViewerPublic(
                user_id=user.id,
                full_name=user.full_name,
                employee_code=user.employee_code,
                reasons=[],
                field_names=[],
            ),
        )
        if reason not in entry.reasons:
            entry.reasons.append(reason)
        if field_name is not None and field_name not in entry.field_names:
            entry.field_names.append(field_name)

    for entry in people.values():
        entry.reasons.sort(key=lambda r: _RANK[r])
    ordered = sorted(people.values(), key=lambda p: (_RANK[p.reasons[0]], p.full_name))
    members = await workspaces.list_members(session, workspace_id=context.workspace.id)
    return RecordViewers(
        people=ordered,
        workspace_name=context.workspace.name,
        workspace_member_count=len(members),
    )
