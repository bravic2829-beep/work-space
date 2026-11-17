"""Reporting a task as done, approving it and sending it back (docs/usecases.md 3.3).

The status column holds the state. Each option has a kind (todo, in_progress, review, done), and
this module moves a record between kinds:

- submit (UC-K4, and UC-K8 for a parent task): a person named in the assignee column moves the
  task to the "review" option. The reviewer, who is the person who created the task, is told.
- approve (UC-K5): the reviewer moves a task in review to the "done" option.
- reject (UC-K6): the reviewer moves a task in review back to the "in_progress" option, and must
  say why. The reason is written as a comment on the task and the assignees are told.

The reviewer is the person who created the task, or a manager of a sheet that shows it. An
organization admin may do every step (report, approve, send back) on any task. Every
step is written to the task's history. Sending the same step twice is refused: the second request
carries an old version (If-Match) or finds the task already moved on.

Moving the status this way works even when the status column is read-only for the person (an
assignee normally only reads it), but never when the column is hidden from them.
"""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import FORBIDDEN, ProblemError
from app.modules.activity.log import record_activity
from app.modules.activity.models import ActivityAction
from app.modules.comments.models import Comment
from app.modules.fields.models import FieldAccessLevel, FieldSemantic
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

_ACTIVITY = {
    "submit": ActivityAction.SUBMITTED,
    "approve": ActivityAction.APPROVED,
    "reject": ActivityAction.SENT_BACK,
}


async def review_record(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    action: str,
    if_match: str | None,
    reason: str | None = None,
) -> tuple[Record, RecordPublic]:
    """`reason` is required to send work back: the person must know what to change."""
    reason = reason.strip() if reason else None
    if action == "reject" and not reason:
        raise ProblemError(
            422,
            "Say what needs to change.",
            errors=[{"field": "reason", "message": "Give a reason to send the task back."}],
        )
    loaded = await load_locked(session, actor, record_id)
    record, fields = loaded.record, loaded.fields
    status = by_semantic((f for f, _ in fields), FieldSemantic.STATUS)
    if status is None:
        raise ProblemError(409, "The table has no status column.")
    levels = {f.id: level for f, level in fields}
    if levels[status.id] == FieldAccessLevel.HIDDEN:
        raise ProblemError(403, FORBIDDEN)

    check_version(record, if_match)

    current = kind_of(status, record.data.get(str(status.id)))
    assignee_ids = service.assignees(record, fields)

    admin = is_org_admin(actor)  # the admin may do every step, for anybody
    if action == "submit":
        if actor.id not in assignee_ids and not admin:
            raise ProblemError(403, "Only a person assigned to the task can report it as done.")
        if current in ("review", "done"):
            raise ProblemError(409, "The task is already waiting for review or done.")
        target = option_of_kind(status, "review")
    else:
        sheet_role = await sheet_access.role_for_record(
            session, actor, record, [f for f, _ in fields]
        )
        if record.created_by != actor.id and sheet_role != SheetRole.MANAGER and not admin:
            raise ProblemError(
                403,
                "Only the person who created the task, or a manager of its sheet, can review it.",
            )
        if current != "review":
            raise ProblemError(409, "The task is not waiting for review.")
        target = option_of_kind(status, "done" if action == "approve" else "in_progress")

    before = record.data.get(str(status.id))
    data: dict[str, Any] = dict(record.data)
    data[str(status.id)] = target
    await write_data(session, record, data)

    columns = loaded.columns
    await record_activity(
        session,
        record_id=record.id,
        actor_id=actor.id,
        action=_ACTIVITY[action],
        changes={str(status.id): {"from": before, "to": target}},
        note=reason if action == "reject" else None,
    )
    if action == "submit":
        await notifications.notify(
            session, NotificationType.REVIEW_REQUESTED, actor, record, columns, {record.created_by}
        )
    elif action == "reject":
        # The reason goes where the person works on the task (its comments) and to their bell.
        session.add(
            Comment(record_id=record.id, author_id=actor.id, body=f"Sent back: {reason}"[:5000])
        )
        await session.flush()
        await notifications.notify(
            session, NotificationType.CHANGES_REQUESTED, actor, record, columns, assignee_ids
        )
    return await render_changed(session, actor, loaded)
