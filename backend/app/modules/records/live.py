"""Telling the people who can see a record that it changed, so their screens read it again.

Like the notification signal (notifications/realtime.py) this is only "something changed": the
browser then asks the normal API, which checks permissions as always, so no data travels over the
socket. It is sent after the transaction commits and never for work that was rolled back.

Every change to a record is caught where it is written (a SQLAlchemy flush), so every path is
covered: edit, create, delete, review, timer, handover, a new assignee. Who is told, among the
people connected right now:
- the people named in the record's user columns before and after the change (so somebody who was
  just taken off the task also sees it go) and its creator;
- the people who may see the record: its viewers, the members of its workspace, organization
  admins.
Nobody else is told, not even that something changed.
"""

import asyncio
import logging
import uuid
from typing import Any

from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session

from app.modules.bases.models import Table, WorkBase
from app.modules.notifications.realtime import hub
from app.modules.records.models import Record, RecordViewer
from app.modules.users.models import OrgRole, User
from app.modules.workspaces.models import WorkspaceMember

logger = logging.getLogger(__name__)

MESSAGE = {"type": "records.changed"}
_CHANGED_KEY = "records_changed"  # record id -> (table id, people named on it)
_SEND_KEY = "records_changed_send"
_tasks: set[asyncio.Task[None]] = set()


def _people_in(data: Any) -> set[uuid.UUID]:
    """Every id in a list of ids (a user column holds a list of user ids)."""
    found: set[uuid.UUID] = set()
    if not isinstance(data, dict):
        return found
    for value in data.values():
        if isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    try:
                        found.add(uuid.UUID(item))
                    except ValueError:
                        pass
    return found


def note_change(session: Session, record: Record) -> None:
    """Remember that this record changed in the current transaction.

    Called for every flush automatically. Code that removes a record with a bulk `DELETE`
    statement (which the ORM does not see) calls it itself, before the delete.
    """
    changed: dict[uuid.UUID, tuple[uuid.UUID, set[uuid.UUID]]] = session.info.setdefault(
        _CHANGED_KEY, {}
    )
    people = _people_in(record.data) | {record.created_by}
    for old in inspect(record).attrs.data.history.deleted or ():
        people |= _people_in(old)
    _, known = changed.setdefault(record.id, (record.table_id, set()))
    known |= people


@event.listens_for(Session, "after_flush")
def _collect(session: Session, _context: object) -> None:
    for obj in [*session.new, *session.dirty, *session.deleted]:
        if isinstance(obj, Record):
            note_change(session, obj)


@event.listens_for(Session, "before_commit")
def _resolve(session: Session) -> None:
    """Work out who to tell. Runs inside the transaction, before the commit."""
    changed: dict[uuid.UUID, tuple[uuid.UUID, set[uuid.UUID]]] | None = session.info.pop(
        _CHANGED_KEY, None
    )
    if not changed:
        return
    online = hub.connected()
    if not online:
        return
    try:
        record_ids = list(changed)
        table_ids = {table_id for table_id, _ in changed.values()}
        told: set[uuid.UUID] = set().union(*(people for _, people in changed.values())) & online
        with session.no_autoflush:
            told |= set(
                session.execute(
                    select(RecordViewer.user_id).where(
                        RecordViewer.record_id.in_(record_ids), RecordViewer.user_id.in_(online)
                    )
                ).scalars()
            )
            told |= set(
                session.execute(
                    select(WorkspaceMember.user_id)
                    .join(WorkBase, WorkBase.workspace_id == WorkspaceMember.workspace_id)
                    .join(Table, Table.base_id == WorkBase.id)
                    .where(Table.id.in_(table_ids), WorkspaceMember.user_id.in_(online))
                ).scalars()
            )
            told |= set(
                session.execute(
                    select(User.id).where(
                        User.id.in_(online), User.org_role.in_([OrgRole.OWNER, OrgRole.ADMIN])
                    )
                ).scalars()
            )
    except Exception:  # a live hint must never break the save that caused it
        logger.exception("Could not work out who to tell about a record change")
        return
    if told:
        session.info.setdefault(_SEND_KEY, set()).update(told)


@event.listens_for(Session, "after_commit")
def _send(session: Session) -> None:
    told: set[uuid.UUID] | None = session.info.pop(_SEND_KEY, None)
    if not told:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # committed outside an event loop (a script): nobody to tell
        return
    task = loop.create_task(hub.publish(told, MESSAGE))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


@event.listens_for(Session, "after_rollback")
def _forget(session: Session) -> None:
    session.info.pop(_CHANGED_KEY, None)
    session.info.pop(_SEND_KEY, None)
