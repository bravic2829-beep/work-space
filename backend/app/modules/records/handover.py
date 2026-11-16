"""Handing a task over to somebody else, with what was done and the documents that go with it.

Who may hand over: a person assigned to the task, its creator, an editor of the workspace, a
manager of a sheet that shows it, or an organization admin. The recipient must already be able to
open the table (a member of its workspace, an organization admin, or on one of its sheets):
handing over never grants access by itself. The task's assignee becomes the recipient, the
handover is kept (`handovers`), written to the task's history, and the recipient is told.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.activity.log import record_activity
from app.modules.activity.models import ActivityAction, Handover
from app.modules.fields.models import FieldAccessLevel, FieldSemantic
from app.modules.permissions.service import is_org_admin, workspace_role
from app.modules.records import service, visibility
from app.modules.records.models import Record
from app.modules.records.schemas import RecordPublic
from app.modules.sheets import access as sheet_access
from app.modules.sheets.models import SheetRole
from app.modules.users.models import User, UserStatus

FORBIDDEN = "You do not have permission to do this."


class HandoverRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    to_user_id: uuid.UUID
    # What was done, and what the next person needs to know.
    result: str = Field(min_length=1, max_length=5000)
    # Links or names of the documents that go with it.
    documents: str | None = Field(default=None, max_length=2000)


async def hand_over(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    data: HandoverRequest,
    if_match: str | None,
) -> tuple[Record, RecordPublic]:
    result = data.result.strip()
    if not result:
        raise ProblemError(
            422,
            "Say what was done.",
            errors=[{"field": "result", "message": "Describe the result being handed over."}],
        )
    record, context = await service._load(session, actor, record_id, for_update=True)
    fields = await service._fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id, record=record
    )
    columns = [f for f, _ in fields]
    assignee = next((f for f in columns if f.semantic == FieldSemantic.ASSIGNEE), None)
    if assignee is None:
        raise ProblemError(409, "The table has no assignee column.")
    if dict((f.id, level) for f, level in fields)[assignee.id] == FieldAccessLevel.HIDDEN:
        raise ProblemError(403, FORBIDDEN)

    expected = service.parse_if_match(if_match)
    if expected != record.version:
        raise ProblemError(412, "The record was changed by somebody else. Reload it and try again.")

    current = service.assignees(record, fields)
    sheet_role = await sheet_access.role_for_record(session, actor, record, columns)
    allowed = (
        actor.id in current
        or record.created_by == actor.id
        or context.can_edit
        or is_org_admin(actor)
        or sheet_role == SheetRole.MANAGER
    )
    if not allowed:
        raise ProblemError(
            403, "Only the assignee, the person who gave the task or a manager can hand it over."
        )

    recipient = (
        await session.execute(
            select(User).where(
                User.id == data.to_user_id,
                User.organization_id == actor.organization_id,
                User.status == UserStatus.ACTIVE,
            )
        )
    ).scalar_one_or_none()
    if recipient is None:
        raise ProblemError(422, "An employee does not exist or is disabled.")
    if current == {recipient.id}:
        raise ProblemError(409, "The task is already with this person.")
    can_open = (
        is_org_admin(recipient)
        or await workspace_role(session, recipient, context.workspace) is not None
        or await sheet_access.has_sheet_on_table(session, recipient, record.table_id)
    )
    if not can_open:
        raise ProblemError(
            422,
            "This person cannot open the table. Add them to a sheet or the workspace first.",
        )

    before: Any = record.data.get(str(assignee.id))
    new_data = dict(record.data)
    new_data[str(assignee.id)] = [str(recipient.id)]
    record.data = new_data
    record.version = record.version + 1
    record.updated_at = datetime.now(UTC)
    await session.flush()
    await visibility.rebuild_record(session, record, columns)

    session.add(
        Handover(
            record_id=record.id,
            from_user_id=next(iter(current), None) if len(current) == 1 else None,
            to_user_id=recipient.id,
            by_user_id=actor.id,
            result=result,
            documents=(data.documents or "").strip() or None,
        )
    )
    note = result if not data.documents else f"{result}\nDocuments: {data.documents.strip()}"
    await record_activity(
        session,
        record_id=record.id,
        actor_id=actor.id,
        action=ActivityAction.HANDED_OVER,
        changes={str(assignee.id): {"from": before, "to": [str(recipient.id)]}},
        note=note,
    )
    await service._notify_newassignees(
        session, actor, record, fields, before=current, after=record.data
    )
    await session.refresh(record)
    rendered = await service.render(session, actor, context, [record], service._visible(fields))
    return record, rendered[0]
