"""The manager's overview of a task table: what is late, waiting for review, and who has what.

Every number is counted over the tasks the caller may open (the same rule as the table itself),
and a number that would need a column hidden from the caller is not given (None), so nothing
hidden can be worked out from the totals.
"""

import uuid
from typing import Any

from pydantic import BaseModel
from sqlalchemy import Select, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dates import day_or_today
from app.modules.bases.models import Table, WorkBase
from app.modules.bases.repository import live_conditions
from app.modules.fields.models import Field, FieldAccessLevel, FieldSemantic
from app.modules.permissions.service import TableContext, is_org_admin, require_table_read
from app.modules.records import service as records
from app.modules.records.models import Record, RecordViewer
from app.modules.sheets.models import Sheet, SheetMember
from app.modules.users.models import User
from app.modules.workspaces.models import Workspace, WorkspaceMember


class ReportTable(BaseModel):
    id: uuid.UUID
    name: str
    workspace_name: str


class StatusCount(BaseModel):
    kind: str
    name: str
    count: int


class PersonLoad(BaseModel):
    user_id: uuid.UUID
    full_name: str
    employee_code: str
    open: int
    overdue: int
    in_review: int
    blocked: int
    done: int


class Overview(BaseModel):
    table_id: uuid.UUID
    table_name: str
    day: str
    total: int
    # None: the column the number needs is hidden from the caller.
    open: int | None
    in_review: int | None
    blocked: int | None
    paused: int | None
    done: int | None
    overdue: int | None
    due_today: int | None
    unassigned: int | None
    by_status: list[StatusCount] | None
    people: list[PersonLoad] | None


def visible_records(actor: User, context: TableContext, query: Select[Any]) -> Select[Any]:
    """The live tasks of the table that the caller may open: all of them for somebody who sees
    everything, otherwise the ones they are a viewer of (the rule of the table itself)."""
    query = query.where(Record.table_id == context.table.id, Record.deleted_at.is_(None))
    if not records.sees_everything(actor, context):
        query = query.where(
            exists().where(RecordViewer.record_id == Record.id, RecordViewer.user_id == actor.id)
        )
    return query


def _has_semantic(semantic: FieldSemantic) -> Any:
    return exists().where(
        Field.table_id == Table.id, Field.semantic == semantic, Field.deleted_at.is_(None)
    )


async def report_tables(session: AsyncSession, actor: User) -> list[ReportTable]:
    """The task tables (an assignee and a status column) the caller may open."""
    query = (
        select(Table, Workspace.name)
        .join(WorkBase, WorkBase.id == Table.base_id)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .where(
            *live_conditions(actor.organization_id),
            _has_semantic(FieldSemantic.ASSIGNEE),
            _has_semantic(FieldSemantic.STATUS),
        )
        .order_by(Workspace.name, Table.name)
    )
    if not is_org_admin(actor):
        query = query.where(
            or_(
                exists().where(
                    WorkspaceMember.workspace_id == Workspace.id,
                    WorkspaceMember.user_id == actor.id,
                ),
                exists().where(
                    Sheet.table_id == Table.id,
                    Sheet.archived_at.is_(None),
                    SheetMember.sheet_id == Sheet.id,
                    SheetMember.user_id == actor.id,
                ),
            )
        )
    rows = (await session.execute(query)).all()
    return [ReportTable(id=t.id, name=t.name, workspace_name=name) for t, name in rows]


async def overview(
    session: AsyncSession, actor: User, table_id: uuid.UUID, day: str | None
) -> Overview:
    today = day_or_today(day)
    context = await require_table_read(session, actor, table_id)
    fields = await records.fields_with_access(session, actor, context)
    shown = {
        f.semantic: f for f, level in fields if level != FieldAccessLevel.HIDDEN and f.semantic
    }
    status = shown.get(FieldSemantic.STATUS)
    due = shown.get(FieldSemantic.DUE_DATE)
    assignee = shown.get(FieldSemantic.ASSIGNEE)

    query = visible_records(actor, context, select(Record.data))
    rows: list[dict[str, Any]] = list((await session.execute(query)).scalars().all())

    options = status.config.get("options", []) if status else []
    kind_of = {o["id"]: o["kind"] for o in options}
    by_option = {o["id"]: 0 for o in options}

    def kind(data: dict[str, Any]) -> str:
        if status is None:
            return "todo"
        return str(kind_of.get(data.get(str(status.id)), "todo"))

    def late(data: dict[str, Any]) -> bool:
        if due is None:
            return False
        value = data.get(str(due.id))
        return isinstance(value, str) and value[:10] < today and kind(data) != "done"

    def tally(counts: dict[str, int], k: str, is_late: bool) -> None:
        """Count one task into open or done, and into in review, blocked and overdue when it is.

        A paused or blocked task is still open work, and it can be overdue."""
        counts["done" if k == "done" else "open"] += 1
        counts["in_review"] += k == "review"
        counts["blocked"] += k == "blocked"
        counts["overdue"] += is_late

    people: dict[uuid.UUID, dict[str, int]] = {}
    totals = {
        "open": 0,
        "in_review": 0,
        "blocked": 0,
        "paused": 0,
        "done": 0,
        "overdue": 0,
        "due_today": 0,
        "unassigned": 0,
    }
    for data in rows:
        k = kind(data)
        if status is not None:
            chosen = data.get(str(status.id))
            first = options[0]["id"] if options else None
            key = chosen if chosen in by_option else first
            if key is not None:
                by_option[key] += 1
        is_late = late(data)
        tally(totals, k, is_late)
        totals["paused"] += k == "paused"
        if due is not None:
            value = data.get(str(due.id))
            totals["due_today"] += isinstance(value, str) and value[:10] == today and k != "done"
        if assignee is not None:
            named = [uuid.UUID(str(i)) for i in data.get(str(assignee.id), [])]
            if not named:
                totals["unassigned"] += 1
            for person in named:
                load = people.setdefault(
                    person, {"open": 0, "overdue": 0, "in_review": 0, "blocked": 0, "done": 0}
                )
                tally(load, k, is_late)

    loads: list[PersonLoad] | None = None
    if assignee is not None:
        users = {
            u.id: u
            for u in (
                await session.execute(select(User).where(User.id.in_(list(people))))
            ).scalars()
        }
        loads = sorted(
            (
                PersonLoad(
                    user_id=uid,
                    full_name=users[uid].full_name if uid in users else "Unknown employee",
                    employee_code=users[uid].employee_code if uid in users else "",
                    **counts,
                )
                for uid, counts in people.items()
            ),
            key=lambda p: (-p.overdue, -p.open, p.full_name),
        )

    return Overview(
        table_id=context.table.id,
        table_name=context.table.name,
        day=today,
        total=len(rows),
        open=totals["open"] if status else None,
        in_review=totals["in_review"] if status else None,
        blocked=totals["blocked"] if status else None,
        paused=totals["paused"] if status else None,
        done=totals["done"] if status else None,
        overdue=totals["overdue"] if due else None,
        due_today=totals["due_today"] if due else None,
        unassigned=totals["unassigned"] if assignee else None,
        by_status=(
            [StatusCount(kind=o["kind"], name=o["name"], count=by_option[o["id"]]) for o in options]
            if status
            else None
        ),
        people=loads,
    )
