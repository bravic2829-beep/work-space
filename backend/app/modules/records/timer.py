"""The task timer: the person who gives the work presses Start, the assignee presses Stop.

Two date-time columns hold the moments (semantics timer_start and timer_stop); the time spent is
their difference, worked out by whoever shows it.

- start: the person who created the task (or an organization admin) begins the clock. A task still
  in "to do" moves to "in progress".
- stop: a person assigned to the task (or the creator, or an admin) ends the clock. The task moves
  to "review" like "Report as done" does, and the creator is told.

Like the review endpoint this works even when the column is read-only for the person, but never
when the column is hidden from them.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.activity.log import diff, record_activity
from app.modules.activity.models import ActivityAction
from app.modules.fields.models import FieldAccessLevel, FieldSemantic
from app.modules.notifications import service as notifications
from app.modules.notifications.models import NotificationType
from app.modules.permissions.service import is_org_admin
from app.modules.records import review, service
from app.modules.records.models import Record
from app.modules.records.schemas import RecordPublic
from app.modules.sheets import access as sheet_access
from app.modules.sheets.models import SheetRole
from app.modules.users.models import User


def _moment() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


async def timer_record(
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
    started = next((f for f, _ in fields if f.semantic == FieldSemantic.TIMER_START), None)
    stopped = next((f for f, _ in fields if f.semantic == FieldSemantic.TIMER_STOP), None)
    if started is None or stopped is None:
        raise ProblemError(409, "The table has no timer columns.")
    levels = {f.id: level for f, level in fields}
    if FieldAccessLevel.HIDDEN in (levels[started.id], levels[stopped.id]):
        raise ProblemError(403, review.FORBIDDEN)

    expected = service.parse_if_match(if_match)
    if expected != record.version:
        raise ProblemError(412, "The record was changed by somebody else. Reload it and try again.")

    is_creator = record.created_by == actor.id
    sheet_role = await sheet_access.role_for_record(session, actor, record, [f for f, _ in fields])
    allowed_by_role = is_creator or is_org_admin(actor) or sheet_role == SheetRole.MANAGER
    began = record.data.get(str(started.id))
    ended = record.data.get(str(stopped.id))
    data: dict[str, Any] = dict(record.data)
    status = next((f for f, _ in fields if f.semantic == FieldSemantic.STATUS), None)
    current = review._kind_of(status, record.data.get(str(status.id))) if status else "todo"
    now = _moment()

    if action == "start":
        if not allowed_by_role:
            raise ProblemError(403, "Only the person who gave the task can start the timer.")
        if began:
            raise ProblemError(409, "The timer was already started.")
        data[str(started.id)] = now
        data.pop(str(stopped.id), None)
        if status is not None and current == "todo":
            data[str(status.id)] = review._option_of_kind(status, "in_progress")
    else:
        if not (allowed_by_role or actor.id in service.assignees(record, fields)):
            raise ProblemError(403, "Only a person assigned to the task can stop the timer.")
        if not began:
            raise ProblemError(409, "The timer has not been started.")
        if ended:
            raise ProblemError(409, "The timer was already stopped.")
        data[str(stopped.id)] = now
        if status is not None and current not in ("review", "done"):
            data[str(status.id)] = review._option_of_kind(status, "review")

    history = diff(record.data, data)
    record.data = data
    record.version = record.version + 1
    record.updated_at = datetime.now(UTC)
    await session.flush()
    await record_activity(
        session,
        record_id=record.id,
        actor_id=actor.id,
        action=ActivityAction.TIMER_STARTED if action == "start" else ActivityAction.TIMER_STOPPED,
        changes=history,
    )

    if action == "stop" and status is not None and current not in ("review", "done"):
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
