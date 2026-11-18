"""The measures of performance, worked out from the tasks of each person over a month.

Each measure gives a score from 0 to 100, or None when there is nothing to judge (no task, no
submitted task...): a missing measure is never a zero. The tasks counted are the ones the reader
may open (the rule of the tables themselves), so a manager's numbers cover what they can see.

A task belongs to the month when it is due in it, was completed in it, or (with no due date) was
created in it, the same rule as the Overview. A task given to several people counts for each.

- completion_rate: done tasks / tasks of the month.
- on_time_rate: done tasks finished on or before the due date / done tasks that have a due date and
  a known completion day.
- overdue_rate: score = 100 - share of the tasks already due that are late and not done.
- rework_rate: score = 100 - share of the tasks sent for review that were sent back in the month.
- blocked_tasks: score = 100 - share of the open tasks that are blocked.
- update_compliance: needs the weekly updates that are not recorded yet: always None for now.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.activity.models import ActivityAction, ActivityEntry
from app.modules.fields.models import FieldAccessLevel, FieldSemantic
from app.modules.performance.models import Metric
from app.modules.permissions.service import require_table_read
from app.modules.records import service as records
from app.modules.records.models import Record
from app.modules.reports.dashboard import completed_days
from app.modules.reports.service import report_tables, visible_records
from app.modules.users.models import User

# What a reader is told about each measure.
LABELS: dict[Metric, tuple[str, str]] = {
    Metric.COMPLETION_RATE: ("Completion rate", "Done tasks / tasks of the month"),
    Metric.ON_TIME_RATE: (
        "On-time rate",
        "Tasks finished on time / finished tasks that have a deadline",
    ),
    Metric.OVERDUE_RATE: ("Overdue rate", "Late tasks that are not done / tasks already due"),
    Metric.REWORK_RATE: ("Rework rate", "Tasks sent back for changes / tasks sent for review"),
    Metric.BLOCKED_TASKS: ("Blocked tasks", "Blocked tasks / open tasks"),
    Metric.UPDATE_COMPLIANCE: (
        "Update compliance",
        "Updates on time / updates required (not measurable yet)",
    ),
}


@dataclass
class Facts:
    total: int = 0
    done: int = 0
    due: int = 0
    late: int = 0
    open: int = 0
    blocked: int = 0
    measured: int = 0
    on_time: int = 0
    submitted: int = 0
    sent_back: int = 0


@dataclass(frozen=True)
class Reading:
    """A score (0 to 100) with how it was reached, in words."""

    score: float | None
    detail: str


def _share(part: int, whole: int) -> float | None:
    return None if whole == 0 else part / whole


def read(metric: Metric, f: Facts) -> Reading:
    if metric == Metric.COMPLETION_RATE:
        rate = _share(f.done, f.total)
        return Reading(None if rate is None else 100 * rate, f"{f.done} of {f.total} tasks done")
    if metric == Metric.ON_TIME_RATE:
        rate = _share(f.on_time, f.measured)
        return Reading(
            None if rate is None else 100 * rate, f"{f.on_time} of {f.measured} finished on time"
        )
    if metric == Metric.OVERDUE_RATE:
        rate = _share(f.late, f.due)
        return Reading(
            None if rate is None else 100 * (1 - rate), f"{f.late} of {f.due} tasks due are late"
        )
    if metric == Metric.REWORK_RATE:
        rate = _share(f.sent_back, f.submitted)
        return Reading(
            None if rate is None else 100 * (1 - min(1.0, rate)),
            f"{f.sent_back} sent back of {f.submitted} sent for review",
        )
    if metric == Metric.BLOCKED_TASKS:
        rate = _share(f.blocked, f.open)
        return Reading(
            None if rate is None else 100 * (1 - rate),
            f"{f.blocked} of {f.open} open tasks blocked",
        )
    return Reading(None, "Not measurable yet")


def month_bounds(period: str) -> tuple[date, date]:
    """The first and last day of a month written "2026-11"."""
    year, month = (int(part) for part in period.split("-"))
    first = date(year, month, 1)
    after = date(year + month // 12, month % 12 + 1, 1)
    return first, after - timedelta(days=1)


async def collect(
    session: AsyncSession,
    actor: User,
    *,
    start: date,
    end: date,
    today: date,
    people: set[uuid.UUID],
) -> dict[uuid.UUID, Facts]:
    """The facts of each of these people over the month, from the tasks the actor may open."""
    first, last, today_s = start.isoformat(), end.isoformat(), today.isoformat()
    moment_from = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    moment_to = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    facts: dict[uuid.UUID, Facts] = {}

    for entry in await report_tables(session, actor):
        context = await require_table_read(session, actor, entry.id)
        fields = await records.fields_with_access(session, actor, context)
        shown = {
            f.semantic: f for f, level in fields if level != FieldAccessLevel.HIDDEN and f.semantic
        }
        status = shown.get(FieldSemantic.STATUS)
        assignee = shown.get(FieldSemantic.ASSIGNEE)
        due = shown.get(FieldSemantic.DUE_DATE)
        if status is None or assignee is None:
            continue
        options = status.config.get("options", [])
        kind_of = {o["id"]: o["kind"] for o in options}
        done_ids = [o["id"] for o in options if o["kind"] == "done"]
        done_on = await completed_days(session, entry.id, status, done_ids)

        # How many times each task was sent for review and sent back during the month.
        moves: dict[uuid.UUID, dict[ActivityAction, int]] = {}
        rows = await session.execute(
            select(ActivityEntry.record_id, ActivityEntry.action, func.count())
            .join(Record, Record.id == ActivityEntry.record_id)
            .where(
                Record.table_id == entry.id,
                Record.deleted_at.is_(None),
                ActivityEntry.action.in_([ActivityAction.SUBMITTED, ActivityAction.SENT_BACK]),
                ActivityEntry.created_at >= moment_from,
                ActivityEntry.created_at < moment_to,
            )
            .group_by(ActivityEntry.record_id, ActivityEntry.action)
        )
        for record_id, action, count in rows.all():
            moves.setdefault(record_id, {})[action] = count

        query = visible_records(actor, context, select(Record.id, Record.data, Record.created_at))
        for record_id, data, created_at in (await session.execute(query)).all():
            names = {uuid.UUID(str(i)) for i in data.get(str(assignee.id), [])} & people
            if not names:
                continue
            kind = str(kind_of.get(data.get(str(status.id)), "todo"))
            due_day = None
            if due is not None:
                value = data.get(str(due.id))
                due_day = value[:10] if isinstance(value, str) and value else None
            done_day = done_on.get(record_id) if kind == "done" else None
            created_day = created_at.astimezone(UTC).date().isoformat()
            asked = moves.get(record_id, {})
            in_month = (
                (due_day is not None and first <= due_day <= last)
                or (done_day is not None and first <= done_day <= last)
                or (due_day is None and first <= created_day <= last)
            )
            if not in_month and not asked:
                continue
            for who in names:
                f = facts.setdefault(who, Facts())
                f.submitted += asked.get(ActivityAction.SUBMITTED, 0)
                f.sent_back += asked.get(ActivityAction.SENT_BACK, 0)
                if not in_month:
                    continue
                f.total += 1
                if kind == "done":
                    f.done += 1
                    if due_day and done_day:
                        f.measured += 1
                        f.on_time += done_day <= due_day
                else:
                    f.open += 1
                    f.blocked += kind == "blocked"
                    if due_day is not None and due_day < today_s:
                        f.late += 1
                if due_day is not None and due_day <= today_s:
                    f.due += 1
    return facts
