"""Performance: criteria with weights, and the score of each person for a month.

The rules, all written here:
- Only an admin changes the criteria (name, weight, source, on or off); every change is kept with
  who made it, when, and the reason.
- A criterion is measured from the tasks (a metric of metrics.py) or scored by a person (manual).
- Score of a person = sum(score x weight) / sum(weight), over the active criteria that have a score
  for them. A criterion with nothing to judge is left out, never counted as a zero, and the
  `coverage` says how much of the total weight was judged. The weights need not add up to 100.
- Who sees whom: an admin sees everybody, a manager sees themselves and the people they manage,
  anybody else sees only themselves.
- Who writes a manual score: an admin, or the manager of the person; a person never scores
  themselves (unless they are an admin). The reason is required and kept.
- Nothing here rewards or punishes anybody: it only gives numbers, with how they were reached.
"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dates import day_or_today
from app.core.db import flush_or_conflict
from app.core.errors import FORBIDDEN, ProblemError
from app.modules.performance import metrics
from app.modules.performance.models import Criterion, CriterionChange, ManualScore, Metric
from app.modules.performance.schemas import (
    ChangePublic,
    Criteria,
    CriterionCreate,
    CriterionPublic,
    CriterionScore,
    CriterionUpdate,
    MetricInfo,
    PersonScore,
    Scores,
    ScoreSet,
)
from app.modules.permissions.service import is_org_admin
from app.modules.users.models import User, UserStatus

MAX_PEOPLE = 200
DUPLICATE = "A criterion with this name already exists."

# What a new organization starts with (the weights add up to 100). The first three are measured
# from the tasks, the others are scored by a person.
DEFAULTS: list[tuple[str, str, int, Metric | None]] = [
    (
        "Task completion",
        "Share of tasks completed, counting the tasks of the month.",
        25,
        Metric.COMPLETION_RATE,
    ),
    (
        "On-time delivery",
        "Share of finished tasks that were done by their deadline.",
        20,
        Metric.ON_TIME_RATE,
    ),
    (
        "Work quality",
        "How well the work meets the requirements: how often it had to be sent back for changes.",
        20,
        Metric.REWORK_RATE,
    ),
    (
        "Initiative and responsibility",
        "Updating progress, warning about risks, solving problems.",
        15,
        None,
    ),
    (
        "Collaboration and handover",
        "Working with others, answering, handing over completely.",
        10,
        None,
    ),
    (
        "Improvement and growth",
        "Suggesting and applying improvements, learning new skills.",
        10,
        None,
    ),
]


def _require_admin(actor: User) -> None:
    if not is_org_admin(actor):
        raise ProblemError(403, FORBIDDEN)


def _public(c: Criterion) -> CriterionPublic:
    return CriterionPublic(
        id=c.id,
        name=c.name,
        description=c.description,
        weight=c.weight,
        metric=c.metric,
        is_active=c.is_active,
        position=c.position,
    )


async def _criteria(session: AsyncSession, actor: User) -> list[Criterion]:
    rows = (
        (
            await session.execute(
                select(Criterion)
                .where(Criterion.organization_id == actor.organization_id)
                .order_by(Criterion.position, Criterion.created_at, Criterion.id)
            )
        )
        .scalars()
        .all()
    )
    if rows:
        return list(rows)
    for position, (name, description, weight, metric) in enumerate(DEFAULTS):
        session.add(
            Criterion(
                organization_id=actor.organization_id,
                name=name,
                description=description,
                weight=weight,
                metric=metric,
                position=position,
            )
        )
    await flush_or_conflict(session, DUPLICATE)
    return await _criteria(session, actor)


async def list_criteria(session: AsyncSession, actor: User) -> Criteria:
    rows = await _criteria(session, actor)
    return Criteria(
        criteria=[_public(c) for c in rows],
        total_weight=sum(c.weight for c in rows if c.is_active),
        can_manage=is_org_admin(actor),
        metrics=[
            MetricInfo(
                id=m,
                label=label,
                description=description,
                measurable=m != Metric.UPDATE_COMPLIANCE,
            )
            for m, (label, description) in metrics.LABELS.items()
        ],
    )


async def _one(session: AsyncSession, actor: User, criterion_id: uuid.UUID) -> Criterion:
    criterion = (
        await session.execute(
            select(Criterion).where(
                Criterion.id == criterion_id, Criterion.organization_id == actor.organization_id
            )
        )
    ).scalar_one_or_none()
    if criterion is None:
        raise ProblemError(404, "The criterion does not exist.")
    return criterion


def _log(
    session: AsyncSession,
    actor: User,
    criterion: Criterion,
    changes: dict[str, Any],
    reason: str | None,
) -> None:
    session.add(
        CriterionChange(
            criterion_id=criterion.id, actor_id=actor.id, changes=changes, reason=reason
        )
    )


async def create_criterion(
    session: AsyncSession, actor: User, data: CriterionCreate
) -> CriterionPublic:
    _require_admin(actor)
    rows = await _criteria(session, actor)
    criterion = Criterion(
        organization_id=actor.organization_id,
        name=data.name,
        description=data.description or None,
        weight=data.weight,
        metric=data.metric,
        position=max((c.position for c in rows), default=-1) + 1,
    )
    session.add(criterion)
    await flush_or_conflict(session, DUPLICATE)
    _log(
        session,
        actor,
        criterion,
        {
            "created": {
                "name": data.name,
                "weight": data.weight,
                "metric": data.metric.value if data.metric else None,
            }
        },
        None,
    )
    await session.flush()
    return _public(criterion)


async def update_criterion(
    session: AsyncSession, actor: User, criterion_id: uuid.UUID, data: CriterionUpdate
) -> CriterionPublic:
    _require_admin(actor)
    criterion = await _one(session, actor, criterion_id)
    sent = data.model_fields_set - {"reason"}
    changes: dict[str, Any] = {}
    for key in sent:
        new = getattr(data, key)
        if key == "description":
            new = new or None
        old = getattr(criterion, key)
        if old == new:
            continue
        changes[key] = {
            "from": old.value if isinstance(old, Metric) else old,
            "to": new.value if isinstance(new, Metric) else new,
        }
        setattr(criterion, key, new)
    if changes:
        await flush_or_conflict(session, DUPLICATE)
        _log(session, actor, criterion, changes, data.reason)
        await session.flush()
    return _public(criterion)


async def history(
    session: AsyncSession, actor: User, criterion_id: uuid.UUID
) -> list[ChangePublic]:
    _require_admin(actor)
    await _one(session, actor, criterion_id)
    rows = await session.execute(
        select(CriterionChange, User.full_name)
        .join(User, User.id == CriterionChange.actor_id)
        .where(CriterionChange.criterion_id == criterion_id)
        .order_by(CriterionChange.created_at.desc(), CriterionChange.id)
    )
    return [
        ChangePublic(
            id=c.id,
            actor_name=name,
            changes=c.changes,
            reason=c.reason,
            created_at=c.created_at,
        )
        for c, name in rows.all()
    ]


# --- scores --------------------------------------------------------------------------------------


async def _people(
    session: AsyncSession, actor: User, department_id: uuid.UUID | None
) -> list[User]:
    """The people the actor may see the scores of."""
    query = select(User).where(
        User.organization_id == actor.organization_id, User.status == UserStatus.ACTIVE
    )
    if is_org_admin(actor):
        if department_id is not None:
            query = query.where(User.department_id == department_id)
    else:
        query = query.where((User.id == actor.id) | (User.manager_id == actor.id))
        if department_id is not None:
            query = query.where(User.department_id == department_id)
    rows = await session.execute(query.order_by(User.full_name, User.id).limit(MAX_PEOPLE))
    return list(rows.scalars().all())


def _can_score(actor: User, person: User) -> bool:
    return is_org_admin(actor) or (person.manager_id == actor.id and person.id != actor.id)


def _month_of(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


async def scores(
    session: AsyncSession,
    actor: User,
    *,
    period: str | None,
    department_id: uuid.UUID | None,
    day: str | None,
) -> Scores:
    today = date.fromisoformat(day_or_today(day))
    month = period or _month_of(today)
    start, end = metrics.month_bounds(month)
    criteria = [c for c in await _criteria(session, actor) if c.is_active]
    people = await _people(session, actor, department_id)
    ids = {p.id for p in people}
    facts = (
        await metrics.collect(session, actor, start=start, end=end, today=today, people=ids)
        if any(c.metric is not None for c in criteria) and ids
        else {}
    )
    manual: dict[tuple[uuid.UUID, uuid.UUID], ManualScore] = {}
    if ids:
        for row in (
            await session.execute(
                select(ManualScore).where(ManualScore.user_id.in_(ids), ManualScore.period == month)
            )
        ).scalars():
            manual[(row.criterion_id, row.user_id)] = row

    result: list[PersonScore] = []
    for person in people:
        f = facts.get(person.id, metrics.Facts())
        row_scores: list[CriterionScore] = []
        weighted = judged = 0.0
        for c in criteria:
            if c.metric is not None:
                reading = metrics.read(c.metric, f)
                row_scores.append(
                    CriterionScore(
                        criterion_id=c.id,
                        score=None if reading.score is None else round(reading.score, 1),
                        source="auto" if reading.score is not None else "none",
                        detail=reading.detail,
                    )
                )
                value = reading.score
            else:
                saved = manual.get((c.id, person.id))
                value = None if saved is None else float(saved.score)
                row_scores.append(
                    CriterionScore(
                        criterion_id=c.id,
                        score=value,
                        source="manual" if saved else "none",
                        detail="Scored by a person" if saved else "Not scored yet",
                        reason=saved.reason if saved else None,
                    )
                )
            if value is not None:
                weighted += value * c.weight
                judged += c.weight
        everything = sum(c.weight for c in criteria)
        result.append(
            PersonScore(
                user_id=person.id,
                full_name=person.full_name,
                employee_code=person.employee_code,
                scores=row_scores,
                total=round(weighted / judged, 1) if judged > 0 else None,
                coverage=round(judged / everything, 4) if everything > 0 else 0.0,
                can_score=_can_score(actor, person),
            )
        )
    return Scores(period=month, criteria=[_public(c) for c in criteria], people=result)


async def set_score(session: AsyncSession, actor: User, data: ScoreSet) -> None:
    criterion = await _one(session, actor, data.criterion_id)
    if criterion.metric is not None or not criterion.is_active:
        raise ProblemError(422, "This criterion is not scored by a person.")
    person = (
        await session.execute(
            select(User).where(
                User.id == data.user_id, User.organization_id == actor.organization_id
            )
        )
    ).scalar_one_or_none()
    if person is None:
        raise ProblemError(404, "The person does not exist.")
    if not _can_score(actor, person):
        raise ProblemError(403, FORBIDDEN)
    existing = (
        await session.execute(
            select(ManualScore).where(
                ManualScore.criterion_id == criterion.id,
                ManualScore.user_id == person.id,
                ManualScore.period == data.period,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        session.add(
            ManualScore(
                criterion_id=criterion.id,
                user_id=person.id,
                period=data.period,
                score=data.score,
                reason=data.reason,
                scored_by=actor.id,
            )
        )
    else:
        existing.score = data.score
        existing.reason = data.reason
        existing.scored_by = actor.id
    await session.flush()
