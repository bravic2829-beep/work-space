"""Reporting a task as done, approving it and sending it back (docs/usecases.md 3.3).

The status column holds the state. Each option has a kind (todo, in_progress, review, done), and
this module moves a record between kinds:

- submit (UC-K4, and UC-K8 for a parent task): a person named in the assignee column moves the
  task to the "review" option. The reviewer, who is the person who created the task, is told.
- approve (UC-K5): the reviewer moves a task in review to the "done" option.
- reject (UC-K6): the reviewer moves a task in review back to the "in_progress" option.

Moving the status this way works even when the status column is read-only for the person (an
assignee normally only reads it), but never when the column is hidden from them.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.fields.models import Field, FieldAccessLevel, FieldSemantic
from app.modules.notifications import service as notifications
from app.modules.notifications.models import NotificationType
from app.modules.records import service
from app.modules.records.models import Record
from app.modules.records.schemas import RecordPublic
from app.modules.users.models import User

FORBIDDEN = "You do not have permission to do this."


def _kind_of(status: Field, option_id: str | None) -> str:
    """The kind of the current option. A task with no status yet counts as "todo"."""
    if option_id is None:
        return "todo"
    for option in status.config.get("options", []):
        if option["id"] == option_id:
            return str(option["kind"])
    return "todo"


def _option_of_kind(status: Field, kind: str) -> str:
    for option in status.config.get("options", []):
        if option.get("kind") == kind:
            return str(option["id"])
    raise ProblemError(409, f"The status column has no option of kind '{kind}'.")


async def review_record(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    action: str,
    if_match: str | None,
) -> tuple[Record, RecordPublic]:
    record, context = await service._load(session, actor, record_id, for_update=True)
    fields = await service._fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id
    )
    status = next((f for f, _ in fields if f.semantic == FieldSemantic.STATUS), None)
    if status is None:
        raise ProblemError(409, "The table has no status column.")
    levels = {f.id: level for f, level in fields}
    if levels[status.id] == FieldAccessLevel.HIDDEN:
        raise ProblemError(403, FORBIDDEN)

    expected = service.parse_if_match(if_match)
    if expected != record.version:
        raise ProblemError(412, "The record was changed by somebody else. Reload it and try again.")

    current = _kind_of(status, record.data.get(str(status.id)))
    assignee_ids = service.assignees(record, fields)

    if action == "submit":
        if actor.id not in assignee_ids:
            raise ProblemError(403, "Only a person assigned to the task can report it as done.")
        if current in ("review", "done"):
            raise ProblemError(409, "The task is already waiting for review or done.")
        target = _option_of_kind(status, "review")
    else:
        if record.created_by != actor.id:
            raise ProblemError(403, "Only the person who created the task can review it.")
        if current != "review":
            raise ProblemError(409, "The task is not waiting for review.")
        target = _option_of_kind(status, "done" if action == "approve" else "in_progress")

    data: dict[str, Any] = dict(record.data)
    data[str(status.id)] = target
    record.data = data
    record.version = record.version + 1
    record.updated_at = datetime.now(UTC)
    await session.flush()

    if action == "submit":
        await notifications.notify(
            session,
            NotificationType.REVIEW_REQUESTED,
            actor,
            record,
            [f for f, _ in fields],
            {record.created_by},
        )
    await session.refresh(record)
    rendered = await service.render(session, actor, context, [record], service._visible(fields))
    return record, rendered[0]
