"""The task timer: the person who gives the work presses Start, the assignee presses Stop.

A timer column (type `timer`) holds both moments in one cell, {"started_at", "finished_at"}; the
time spent is their difference, worked out by whoever shows it. A table may have several timer
columns: the request names one with `field_id`, or leaves it out when there is only one.

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

from app.core.errors import FORBIDDEN, ProblemError
from app.modules.activity.log import diff, record_activity
from app.modules.activity.models import ActivityAction
from app.modules.fields.models import Field, FieldAccessLevel, FieldSemantic, FieldType
from app.modules.fields.semantics import by_semantic
from app.modules.notifications import service as notifications
from app.modules.notifications.models import NotificationType
from app.modules.permissions.service import is_org_admin
from app.modules.records import service
from app.modules.records.models import Record
from app.modules.records.mutation import check_version, load_locked, render_changed, write_data
from app.modules.records.schemas import RecordPublic
from app.modules.records.status import kind_of, option_of_kind
from app.modules.sheets import access as sheet_access
from app.modules.sheets.models import SheetRole
from app.modules.users.models import User


def _moment() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _pick_timer(
    fields: list[tuple[Field, FieldAccessLevel]], field_id: uuid.UUID | None
) -> tuple[Field, FieldAccessLevel]:
    """The timer column the request is about, with the caller's access to it."""
    timers = [(f, level) for f, level in fields if f.type == FieldType.TIMER]
    if field_id is not None:
        found = next(((f, level) for f, level in timers if f.id == field_id), None)
        if found is None:
            raise ProblemError(404, "The timer column does not exist.")
        return found
    if not timers:
        raise ProblemError(409, "The table has no timer column.")
    if len(timers) > 1:
        raise ProblemError(422, "The table has more than one timer column. Say which one.")
    return timers[0]


def _moments(value: Any) -> tuple[str | None, str | None]:
    """The start and the stop held in a cell (a cell that is not an object has neither)."""
    if not isinstance(value, dict):
        return None, None
    return value.get("started_at") or None, value.get("finished_at") or None


async def timer_record(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    action: str,
    if_match: str | None,
    *,
    field_id: uuid.UUID | None = None,
) -> tuple[Record, RecordPublic]:
    loaded = await load_locked(session, actor, record_id)
    record, fields = loaded.record, loaded.fields
    timer, level = _pick_timer(fields, field_id)
    if level == FieldAccessLevel.HIDDEN:
        raise ProblemError(403, FORBIDDEN)

    check_version(record, if_match)

    is_creator = record.created_by == actor.id
    sheet_role = await sheet_access.role_for_record(session, actor, record, [f for f, _ in fields])
    allowed_by_role = is_creator or is_org_admin(actor) or sheet_role == SheetRole.MANAGER
    began, ended = _moments(record.data.get(str(timer.id)))
    data: dict[str, Any] = dict(record.data)
    status = by_semantic((f for f, _ in fields), FieldSemantic.STATUS)
    current = kind_of(status, record.data.get(str(status.id))) if status else "todo"
    now = _moment()

    if action == "start":
        if not allowed_by_role:
            raise ProblemError(403, "Only the person who gave the task can start the timer.")
        if began:
            raise ProblemError(409, "The timer was already started.")
        data[str(timer.id)] = {"started_at": now}
        if status is not None and current == "todo":
            data[str(status.id)] = option_of_kind(status, "in_progress")
    else:
        if not (allowed_by_role or actor.id in service.assignees(record, fields)):
            raise ProblemError(403, "Only a person assigned to the task can stop the timer.")
        if not began:
            raise ProblemError(409, "The timer has not been started.")
        if ended:
            raise ProblemError(409, "The timer was already stopped.")
        data[str(timer.id)] = {"started_at": began, "finished_at": now}
        if status is not None and current not in ("review", "done"):
            data[str(status.id)] = option_of_kind(status, "review")

    history = diff(record.data, data)
    await write_data(session, record, data)
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
            loaded.columns,
            {record.created_by},
        )
    return await render_changed(session, actor, loaded)
