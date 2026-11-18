"""The Overview of Reports: ten numbers over every task table the caller may open, a weekly trend,
the work per project and per person, and the OKR of the current cycle.

Nothing here is stored: each number is counted from the tasks when asked, under the rules of the
table itself (the tasks the caller may open, the columns not hidden from them). A number that needs
a column hidden from the caller in one of the tables counted is not given (None), so nothing hidden
can be worked out from a total. Filtering by person or department needs the assignee column: where
it is hidden, nothing matches, so a filter cannot be used to find out who has what.

The rules, in one place:
- Done: the status is of kind "done". Open: any other kind (paused and blocked are still open).
- Overdue: open and due before today. At risk: open, not yet late, and either blocked or due within
  the next AT_RISK_DAYS days.
- On-time rate: of the done tasks that have a due date and a known completion day, the share that
  were completed on or before the due date. The completion day is the last time the task moved to
  a "done" status in its history; a task with no such history is left out, never counted as late.
- A task is in the period when it is due in it, was completed in it, or (with no due date) was
  created in it.
- Quality score: not measured yet (needs the quality review), so it is None.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, timedelta

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dates import day_or_today
from app.core.errors import ProblemError
from app.modules.activity.models import ActivityEntry
from app.modules.fields.models import Field, FieldAccessLevel, FieldSemantic
from app.modules.okr import service as okr
from app.modules.okr.models import CycleStatus
from app.modules.permissions.service import require_table_read
from app.modules.records import service as records
from app.modules.records.models import Record
from app.modules.reports.service import ReportTable, report_tables, visible_records
from app.modules.users.models import User

AT_RISK_DAYS = 2
MAX_WEEKS = 26
DEFAULT_WEEKS = 8
DEFAULT_AHEAD_DAYS = 14
# More tasks than this in the tables counted: the rest are left out (and the page says so).
MAX_TASKS = 50_000
KINDS = ("todo", "in_progress", "review", "done", "paused", "blocked")


class Cards(BaseModel):
    total: int | None
    completed: int | None
    in_progress: int | None
    overdue: int | None
    at_risk: int | None
    blocked: int | None
    # 0 to 1; None when no finished task has both a due date and a known completion day.
    on_time_rate: float | None
    quality_score: float | None


class TrendPoint(BaseModel):
    week: str
    created: int
    completed: int


class ProjectRow(BaseModel):
    table_id: uuid.UUID
    name: str
    workspace_name: str
    total: int
    completed: int
    overdue: int
    blocked: int


class PersonRow(BaseModel):
    user_id: uuid.UUID
    full_name: str
    employee_code: str
    open: int
    overdue: int
    blocked: int
    done: int


class OkrSnapshot(BaseModel):
    cycle_id: uuid.UUID
    cycle_name: str
    objectives: int
    key_results: int
    progress: float | None
    at_risk: int
    off_track: int


class Dashboard(BaseModel):
    day: str
    period_from: str
    period_to: str
    cards: Cards
    trend: list[TrendPoint]
    projects: list[ProjectRow]
    people: list[PersonRow]
    okr: OkrSnapshot | None
    # The tables counted, so a card can lead to its table when there is only one.
    table_ids: list[uuid.UUID]
    # More tasks than the page counts: the numbers are of the first MAX_TASKS only.
    truncated: bool


@dataclass
class _Tally:
    total: int = 0
    completed: int = 0
    in_progress: int = 0
    overdue: int = 0
    at_risk: int = 0
    blocked: int = 0
    on_time: int = 0
    measured: int = 0
    created: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    done_on: dict[str, int] = field(default_factory=lambda: defaultdict(int))


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _parse(value: str | None, name: str) -> date | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ProblemError(422, f"{name} must look like 2026-11-13.") from None


async def completed_days(
    session: AsyncSession, table_id: uuid.UUID, status: Field, done_ids: list[str]
) -> dict[uuid.UUID, str]:
    """The day each task last moved to a done status, from its history."""
    if not done_ids:
        return {}
    moved_to = ActivityEntry.changes[str(status.id)]["to"].astext
    rows = await session.execute(
        select(ActivityEntry.record_id, func.max(ActivityEntry.created_at))
        .join(Record, Record.id == ActivityEntry.record_id)
        .where(Record.table_id == table_id, Record.deleted_at.is_(None), moved_to.in_(done_ids))
        .group_by(ActivityEntry.record_id)
    )
    return {rid: moment.astimezone(UTC).date().isoformat() for rid, moment in rows.all()}


async def _okr_snapshot(
    session: AsyncSession,
    actor: User,
    person: uuid.UUID | None,
    department_id: uuid.UUID | None,
    today: date,
) -> OkrSnapshot | None:
    cycles = await okr.list_cycles(session, actor)
    if not cycles:
        return None
    current = next(
        (c for c in cycles if c.status == CycleStatus.OPEN and c.starts_on <= today <= c.ends_on),
        None,
    ) or next((c for c in cycles if c.status == CycleStatus.OPEN), cycles[0])
    view = await okr.overview(
        session, actor, current.id, owner_id=person, department_id=department_id
    )
    s = view.summary
    return OkrSnapshot(
        cycle_id=current.id,
        cycle_name=current.name,
        objectives=s.objectives,
        key_results=s.key_results,
        progress=s.progress,
        at_risk=s.at_risk,
        off_track=s.off_track,
    )


async def dashboard(
    session: AsyncSession,
    actor: User,
    *,
    day: str | None,
    start: str | None,
    end: str | None,
    table_id: uuid.UUID | None,
    person: uuid.UUID | None,
    department_id: uuid.UUID | None,
    status_kind: str | None,
) -> Dashboard:
    today = date.fromisoformat(day_or_today(day))
    # By default: the last eight weeks and the next two, so what is coming is counted too.
    period_to = _parse(end, "to") or today + timedelta(days=DEFAULT_AHEAD_DAYS)
    period_from = _parse(start, "from") or today - timedelta(weeks=DEFAULT_WEEKS) + timedelta(
        days=1
    )
    if period_from > period_to:
        raise ProblemError(422, "The period must end after it starts.")
    if status_kind is not None and status_kind not in KINDS:
        raise ProblemError(422, "Unknown status kind.")
    if (period_to - period_from).days > MAX_WEEKS * 7:
        period_from = period_to - timedelta(weeks=MAX_WEEKS) + timedelta(days=1)
    first_day, last_day = period_from.isoformat(), period_to.isoformat()

    tables: list[ReportTable] = await report_tables(session, actor)
    if table_id is not None:
        tables = [t for t in tables if t.id == table_id]
        if not tables:
            raise ProblemError(404, "The table does not exist or you cannot open it.")

    in_department: set[uuid.UUID] | None = None
    if department_id is not None:
        in_department = set(
            (
                await session.execute(
                    select(User.id).where(
                        User.organization_id == actor.organization_id,
                        User.department_id == department_id,
                    )
                )
            )
            .scalars()
            .all()
        )

    tally = _Tally()
    cards_hidden: set[str] = set()
    project_rows: list[ProjectRow] = []
    per_person: dict[uuid.UUID, dict[str, int]] = {}
    seen = 0
    truncated = False
    soon = (today + timedelta(days=AT_RISK_DAYS)).isoformat()
    today_s = today.isoformat()

    for entry in tables:
        context = await require_table_read(session, actor, entry.id)
        fields = await records.fields_with_access(session, actor, context)
        shown = {
            f.semantic: f for f, level in fields if level != FieldAccessLevel.HIDDEN and f.semantic
        }
        status = shown.get(FieldSemantic.STATUS)
        due = shown.get(FieldSemantic.DUE_DATE)
        assignee = shown.get(FieldSemantic.ASSIGNEE)
        if status is None:
            cards_hidden |= {"completed", "in_progress", "blocked", "overdue", "at_risk", "rate"}
        if due is None:
            cards_hidden |= {"overdue", "at_risk", "rate"}

        options = status.config.get("options", []) if status else []
        kind_of = {o["id"]: o["kind"] for o in options}
        done_ids = [o["id"] for o in options if o["kind"] == "done"]
        completed_on = await completed_days(session, entry.id, status, done_ids) if status else {}

        query = visible_records(
            actor, context, select(Record.id, Record.data, Record.created_at)
        ).limit(MAX_TASKS - seen + 1)
        rows = (await session.execute(query)).all()
        if seen + len(rows) > MAX_TASKS:
            truncated = True
            rows = rows[: MAX_TASKS - seen]
        seen += len(rows)

        project = ProjectRow(
            table_id=entry.id,
            name=entry.name,
            workspace_name=entry.workspace_name,
            total=0,
            completed=0,
            overdue=0,
            blocked=0,
        )
        for record_id, data, created_at in rows:
            names: list[uuid.UUID] = []
            if assignee is not None:
                names = [uuid.UUID(str(i)) for i in data.get(str(assignee.id), [])]
            if (person is not None or in_department is not None) and assignee is None:
                continue
            if person is not None and person not in names:
                continue
            if in_department is not None and not in_department.intersection(names):
                continue

            kind = (
                str(kind_of.get(data.get(str(status.id)), "todo")) if status is not None else "todo"
            )
            if status_kind is not None and (status is None or kind != status_kind):
                continue

            due_day = None
            if due is not None:
                value = data.get(str(due.id))
                due_day = value[:10] if isinstance(value, str) and value else None
            done_day = completed_on.get(record_id) if kind == "done" else None
            created_day = created_at.astimezone(UTC).date().isoformat()

            # The trend counts what happened in each week, whatever the period of the cards.
            tally.created[created_day] += 1
            if done_day is not None:
                tally.done_on[done_day] += 1

            in_period = (
                (due_day is not None and first_day <= due_day <= last_day)
                or (done_day is not None and first_day <= done_day <= last_day)
                or (due_day is None and first_day <= created_day <= last_day)
            )
            if not in_period:
                continue

            is_open = kind != "done"
            late = due_day is not None and is_open and due_day < today_s
            risky = (
                is_open
                and not late
                and (kind == "blocked" or (due_day is not None and today_s <= due_day <= soon))
            )
            tally.total += 1
            tally.completed += kind == "done"
            tally.in_progress += kind in ("todo", "in_progress", "review")
            tally.blocked += kind == "blocked"
            tally.overdue += late
            tally.at_risk += risky
            if kind == "done" and due_day and done_day:
                tally.measured += 1
                tally.on_time += done_day <= due_day
            project.total += 1
            project.completed += kind == "done"
            project.overdue += late
            project.blocked += kind == "blocked"
            for who in names:
                load = per_person.setdefault(
                    who, {"open": 0, "overdue": 0, "blocked": 0, "done": 0}
                )
                load["done" if kind == "done" else "open"] += 1
                load["overdue"] += late
                load["blocked"] += kind == "blocked"
        project_rows.append(project)

    users = {
        u.id: u
        for u in (
            await session.execute(select(User).where(User.id.in_(list(per_person))))
        ).scalars()
    }
    people = sorted(
        (
            PersonRow(
                user_id=uid,
                full_name=users[uid].full_name if uid in users else "Unknown employee",
                employee_code=users[uid].employee_code if uid in users else "",
                **load,
            )
            for uid, load in per_person.items()
        ),
        key=lambda p: (-p.overdue, -p.open, p.full_name),
    )

    def count(name: str, value: int) -> int | None:
        return None if name in cards_hidden else value

    cards = Cards(
        total=tally.total,
        completed=count("completed", tally.completed),
        in_progress=count("in_progress", tally.in_progress),
        overdue=count("overdue", tally.overdue),
        at_risk=count("at_risk", tally.at_risk),
        blocked=count("blocked", tally.blocked),
        on_time_rate=(
            round(tally.on_time / tally.measured, 4)
            if tally.measured and "rate" not in cards_hidden
            else None
        ),
        quality_score=None,
    )

    trend: list[TrendPoint] = []
    cursor = week_start(period_from)
    # The trend is what happened: it stops today, whatever the period asks for.
    while cursor <= min(period_to, today):
        days = [(cursor + timedelta(days=i)).isoformat() for i in range(7)]
        trend.append(
            TrendPoint(
                week=cursor.isoformat(),
                created=sum(tally.created.get(d, 0) for d in days),
                completed=sum(tally.done_on.get(d, 0) for d in days),
            )
        )
        cursor += timedelta(days=7)

    snapshot = await _okr_snapshot(session, actor, person, department_id, today)
    return Dashboard(
        day=today_s,
        period_from=first_day,
        period_to=last_day,
        cards=cards,
        trend=trend,
        projects=sorted(project_rows, key=lambda p: (-p.overdue, -p.total, p.name)),
        people=people[:50],
        okr=snapshot,
        table_ids=[t.id for t in tables],
        truncated=truncated,
    )
