"""OKR: cycles, objectives, key results and check-ins, with who may do what.

The rules, all written here (nothing is asked of another system):
- Progress of a key result = (now - start) / (target - start), kept between 0 and 1. It works for a
  target below the start (bring the error rate from 10 to 2). The progress of an objective is the
  average of its key results.
- Everybody in the organization sees every objective that is not private (OKRs are open on
  purpose). A private one is seen by who edits it, who reviews it and the owners of its key results.
- Who edits an objective: its owner, an admin and, for a department objective, the head of that
  department. Who checks in on a key result: its owner and everybody who edits the objective.
- The review (score, merits, to improve) is written by an admin, by the owner's manager, or by the
  owner of the objective it supports; never by the owner (unless an admin). It can be written
  after the cycle is closed: that is when reviews happen.
- A closed cycle cannot be changed, except for its review and by an admin who opens it again.
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import flush_or_conflict
from app.core.errors import FORBIDDEN, ProblemError
from app.modules.bases.models import Table, WorkBase
from app.modules.bases.repository import live_conditions
from app.modules.fields.models import Field
from app.modules.fields.repository import list_fields
from app.modules.fields.titles import title_field
from app.modules.okr.models import (
    CheckIn,
    CycleStatus,
    KeyResult,
    KrStatus,
    Objective,
    OkrCycle,
    OkrLevel,
    TaskLink,
)
from app.modules.okr.schemas import (
    CheckInCreate,
    CheckInPublic,
    CycleCreate,
    CyclePublic,
    CycleUpdate,
    DepartmentRef,
    KeyResultCreate,
    KeyResultPublic,
    KeyResultUpdate,
    LinkedTask,
    ObjectiveCreate,
    ObjectivePublic,
    ObjectiveUpdate,
    OkrDepartment,
    Overview,
    OverviewSummary,
    ReviewUpdate,
    UserRef,
)
from app.modules.organizations.models import Department
from app.modules.permissions.service import (
    TableContext,
    can_view_record,
    is_org_admin,
    load_table_context,
)
from app.modules.records import service as records
from app.modules.records.models import Record
from app.modules.users.models import User, UserStatus
from app.modules.workspaces.models import Workspace

MAX_KEY_RESULTS = 20
MAX_CHECK_INS = 200
# An objective may only support one of the same level or above (the company above a department).
LEVEL_RANK = {OkrLevel.COMPANY: 0, OkrLevel.DEPARTMENT: 1, OkrLevel.PERSONAL: 2}
CLOSED = "This cycle is closed. An admin can open it again."
DUPLICATE_CYCLE = "A cycle with this name already exists."


def progress(start: Decimal, target: Decimal, current: Decimal) -> float:
    """How far a key result is, 0 to 1."""
    span = target - start
    if span == 0:
        return 0.0
    ratio = min(Decimal(1), max(Decimal(0), (current - start) / span))
    return round(float(ratio), 4)


def _decimal(value: float) -> Decimal:
    # Through text, so 0.1 is stored as 0.1 and not as the binary number next to it.
    return Decimal(str(value))


def _invalid(field_name: str, message: str) -> ProblemError:
    return ProblemError(
        422, "One or more values are invalid.", errors=[{"field": field_name, "message": message}]
    )


# --- what is known about the objectives of a request ---------------------------------------------


@dataclass
class Book:
    """The objectives of a request with everything needed to judge who may do what with them."""

    objectives: dict[uuid.UUID, Objective]
    key_results: dict[uuid.UUID, list[KeyResult]] = field(default_factory=dict)
    users: dict[uuid.UUID, User] = field(default_factory=dict)
    departments: dict[uuid.UUID, Department] = field(default_factory=dict)
    last_check_in: dict[uuid.UUID, datetime] = field(default_factory=dict)
    tasks: dict[uuid.UUID, list[LinkedTask]] = field(default_factory=dict)


async def _load_tasks(session: AsyncSession, actor: User, book: Book) -> None:
    keys = [
        kr.id
        for objective_id, krs in book.key_results.items()
        if can_see(actor, book.objectives[objective_id], book)
        for kr in krs
    ]
    if not keys:
        return
    rows = await session.execute(
        select(TaskLink.key_result_id, Record)
        .join(Record, Record.id == TaskLink.record_id)
        .join(Table, Table.id == Record.table_id)
        .join(WorkBase, WorkBase.id == Table.base_id)
        .join(Workspace, Workspace.id == WorkBase.workspace_id)
        .where(
            TaskLink.key_result_id.in_(keys),
            Record.deleted_at.is_(None),
            *live_conditions(actor.organization_id),
        )
        .order_by(Record.id)
    )
    contexts: dict[uuid.UUID, TableContext] = {}
    titles: dict[uuid.UUID, Field | None] = {}
    visible_tasks: dict[uuid.UUID, LinkedTask | None] = {}
    for key, record in rows:
        table_id = record.table_id
        if record.id not in visible_tasks:
            if table_id not in contexts:
                contexts[table_id] = await load_table_context(session, actor, table_id)
                titles[table_id] = title_field(await list_fields(session, table_id=table_id))
            context = contexts[table_id]
            visible_tasks[record.id] = None
            if await can_view_record(session, actor, context, record):
                title = titles[table_id]
                visible = records.visible_columns(
                    await records.fields_with_access(
                        session,
                        actor,
                        context,
                        is_creator=record.created_by == actor.id,
                        record=record,
                    )
                )
                value = (
                    record.data.get(str(title.id))
                    if title and any(col.id == title.id for col, _ in visible)
                    else None
                )
                visible_tasks[record.id] = LinkedTask(
                    id=record.id, table_id=table_id, title=value if isinstance(value, str) else None
                )
        task = visible_tasks[record.id]
        if task is not None:
            book.tasks.setdefault(key, []).append(task)


async def _book(session: AsyncSession, objectives: list[Objective]) -> Book:
    book = Book({o.id: o for o in objectives})
    if not objectives:
        return book
    ids = [o.id for o in objectives]
    parents = {
        o.parent_id for o in objectives if o.parent_id and o.parent_id not in book.objectives
    }
    if parents:
        for parent in (
            await session.execute(select(Objective).where(Objective.id.in_(parents)))
        ).scalars():
            book.objectives[parent.id] = parent

    krs = (
        (
            await session.execute(
                select(KeyResult)
                .where(KeyResult.objective_id.in_(ids))
                .order_by(KeyResult.position, KeyResult.created_at, KeyResult.id)
            )
        )
        .scalars()
        .all()
    )
    for kr in krs:
        book.key_results.setdefault(kr.objective_id, []).append(kr)

    user_ids = {o.owner_id for o in book.objectives.values()} | {kr.owner_id for kr in krs}
    book.users = {
        u.id: u
        for u in (await session.execute(select(User).where(User.id.in_(user_ids)))).scalars()
    }
    department_ids = {o.department_id for o in book.objectives.values() if o.department_id}
    if department_ids:
        book.departments = {
            d.id: d
            for d in (
                await session.execute(select(Department).where(Department.id.in_(department_ids)))
            ).scalars()
        }
    if krs:
        rows = await session.execute(
            select(CheckIn.key_result_id, func.max(CheckIn.created_at))
            .where(CheckIn.key_result_id.in_([kr.id for kr in krs]))
            .group_by(CheckIn.key_result_id)
        )
        book.last_check_in = {key: when for key, when in rows.all()}
    return book


# --- who may do what -----------------------------------------------------------------------------


def can_edit(actor: User, objective: Objective, book: Book) -> bool:
    if is_org_admin(actor) or objective.owner_id == actor.id:
        return True
    department = book.departments.get(objective.department_id) if objective.department_id else None
    return department is not None and department.head_user_id == actor.id


def can_review(actor: User, objective: Objective, book: Book) -> bool:
    if is_org_admin(actor):
        return True
    if objective.owner_id == actor.id:
        return False
    owner = book.users.get(objective.owner_id)
    if owner is not None and owner.manager_id == actor.id:
        return True
    parent = book.objectives.get(objective.parent_id) if objective.parent_id else None
    return parent is not None and parent.owner_id == actor.id


def can_see(actor: User, objective: Objective, book: Book) -> bool:
    if not objective.is_private:
        return True
    if can_edit(actor, objective, book) or can_review(actor, objective, book):
        return True
    return any(kr.owner_id == actor.id for kr in book.key_results.get(objective.id, []))


def can_check_in(actor: User, kr: KeyResult, objective: Objective, book: Book) -> bool:
    return kr.owner_id == actor.id or can_edit(actor, objective, book)


# --- turning rows into what the API shows --------------------------------------------------------


def _user_ref(book: Book, user_id: uuid.UUID) -> UserRef:
    user = book.users.get(user_id)
    if user is None:
        return UserRef(id=user_id, full_name="Unknown employee", employee_code="")
    return UserRef(id=user.id, full_name=user.full_name, employee_code=user.employee_code)


def _optional(value: Decimal | None) -> float | None:
    return None if value is None else float(value)


def _kr_public(actor: User, kr: KeyResult, objective: Objective, book: Book) -> KeyResultPublic:
    return KeyResultPublic(
        id=kr.id,
        objective_id=kr.objective_id,
        title=kr.title,
        owner=_user_ref(book, kr.owner_id),
        unit=kr.unit,
        start_value=float(kr.start_value),
        target_value=float(kr.target_value),
        current_value=float(kr.current_value),
        progress=progress(kr.start_value, kr.target_value, kr.current_value),
        status=kr.status,
        score=_optional(kr.score),
        merits=kr.merits,
        to_improve=kr.to_improve,
        position=kr.position,
        updated_at=kr.updated_at,
        last_check_in_at=book.last_check_in.get(kr.id),
        can_check_in=can_check_in(actor, kr, objective, book),
        tasks=book.tasks.get(kr.id, []),
    )


def _objective_public(
    actor: User, objective: Objective, book: Book, only: set[KrStatus] | None = None
) -> ObjectivePublic:
    krs = book.key_results.get(objective.id, [])
    averaged = [progress(kr.start_value, kr.target_value, kr.current_value) for kr in krs]
    parent = book.objectives.get(objective.parent_id) if objective.parent_id else None
    department = book.departments.get(objective.department_id) if objective.department_id else None
    shown = [kr for kr in krs if only is None or kr.status in only]
    return ObjectivePublic(
        id=objective.id,
        cycle_id=objective.cycle_id,
        title=objective.title,
        description=objective.description,
        owner=_user_ref(book, objective.owner_id),
        level=objective.level,
        department=DepartmentRef(id=department.id, name=department.name) if department else None,
        # A reader who may not see the parent does not learn that there is one.
        parent_id=parent.id if parent and can_see(actor, parent, book) else None,
        is_private=objective.is_private,
        progress=round(sum(averaged) / len(averaged), 4) if averaged else None,
        score=_optional(objective.score),
        merits=objective.merits,
        to_improve=objective.to_improve,
        position=objective.position,
        can_edit=can_edit(actor, objective, book),
        can_review=can_review(actor, objective, book),
        key_results=[_kr_public(actor, kr, objective, book) for kr in shown],
    )


def _cycle_public(cycle: OkrCycle) -> CyclePublic:
    return CyclePublic(
        id=cycle.id,
        name=cycle.name,
        starts_on=cycle.starts_on,
        ends_on=cycle.ends_on,
        status=cycle.status,
        created_at=cycle.created_at,
    )


# --- loading -------------------------------------------------------------------------------------


async def _cycle(session: AsyncSession, actor: User, cycle_id: uuid.UUID) -> OkrCycle:
    cycle = (
        await session.execute(
            select(OkrCycle).where(
                OkrCycle.id == cycle_id, OkrCycle.organization_id == actor.organization_id
            )
        )
    ).scalar_one_or_none()
    if cycle is None:
        raise ProblemError(404, "The cycle does not exist.")
    return cycle


async def _objective(
    session: AsyncSession, actor: User, objective_id: uuid.UUID
) -> tuple[Objective, Book]:
    """An objective the person may see (404 otherwise, so a private one is not given away)."""
    objective = (
        await session.execute(
            select(Objective).where(
                Objective.id == objective_id, Objective.organization_id == actor.organization_id
            )
        )
    ).scalar_one_or_none()
    if objective is None:
        raise ProblemError(404, "The objective does not exist.")
    book = await _book(session, [objective])
    if not can_see(actor, objective, book):
        raise ProblemError(404, "The objective does not exist.")
    return objective, book


async def _key_result(
    session: AsyncSession, actor: User, key_result_id: uuid.UUID
) -> tuple[KeyResult, Objective, Book]:
    kr = (
        await session.execute(
            select(KeyResult)
            .join(Objective, Objective.id == KeyResult.objective_id)
            .where(
                KeyResult.id == key_result_id,
                Objective.organization_id == actor.organization_id,
            )
        )
    ).scalar_one_or_none()
    if kr is None:
        raise ProblemError(404, "The key result does not exist.")
    objective, book = await _objective(session, actor, kr.objective_id)
    return kr, objective, book


async def _open_cycle(session: AsyncSession, objective: Objective) -> None:
    cycle = (
        await session.execute(select(OkrCycle).where(OkrCycle.id == objective.cycle_id))
    ).scalar_one()
    if cycle.status == CycleStatus.CLOSED:
        raise ProblemError(409, CLOSED)


async def change_task_link(
    session: AsyncSession,
    actor: User,
    key_result_id: uuid.UUID,
    record_id: uuid.UUID,
    *,
    attach: bool,
) -> None:
    kr, objective, book = await _key_result(session, actor, key_result_id)
    if not can_check_in(actor, kr, objective, book):
        raise ProblemError(403, FORBIDDEN)
    await _open_cycle(session, objective)
    await records.load_record(session, actor, record_id, for_update=True)
    if attach:
        await session.execute(
            insert(TaskLink)
            .values(key_result_id=kr.id, record_id=record_id)
            .on_conflict_do_nothing()
        )
    else:
        await session.execute(
            delete(TaskLink).where(TaskLink.key_result_id == kr.id, TaskLink.record_id == record_id)
        )


async def _person(session: AsyncSession, actor: User, user_id: uuid.UUID, name: str) -> User:
    user = (
        await session.execute(
            select(User).where(
                User.id == user_id,
                User.organization_id == actor.organization_id,
                User.status == UserStatus.ACTIVE,
            )
        )
    ).scalar_one_or_none()
    if user is None:
        raise _invalid(name, "The person does not exist or is disabled.")
    return user


async def _public_one(
    session: AsyncSession, actor: User, objective_id: uuid.UUID
) -> ObjectivePublic:
    objective, book = await _objective(session, actor, objective_id)
    await _load_tasks(session, actor, book)
    return _objective_public(actor, objective, book)


# --- cycles --------------------------------------------------------------------------------------


def _require_admin(actor: User) -> None:
    if not is_org_admin(actor):
        raise ProblemError(403, FORBIDDEN)


def _check_dates(starts: Any, ends: Any) -> None:
    if ends < starts:
        raise _invalid("ends_on", "The cycle cannot end before it starts.")


async def list_cycles(session: AsyncSession, actor: User) -> list[CyclePublic]:
    rows = await session.execute(
        select(OkrCycle)
        .where(OkrCycle.organization_id == actor.organization_id)
        .order_by(OkrCycle.starts_on.desc(), OkrCycle.name)
    )
    return [_cycle_public(c) for c in rows.scalars()]


async def create_cycle(session: AsyncSession, actor: User, data: CycleCreate) -> CyclePublic:
    _require_admin(actor)
    _check_dates(data.starts_on, data.ends_on)
    cycle = OkrCycle(
        organization_id=actor.organization_id,
        name=data.name,
        starts_on=data.starts_on,
        ends_on=data.ends_on,
        created_by=actor.id,
    )
    session.add(cycle)
    await flush_or_conflict(session, DUPLICATE_CYCLE)
    await session.refresh(cycle)
    return _cycle_public(cycle)


async def update_cycle(
    session: AsyncSession, actor: User, cycle_id: uuid.UUID, data: CycleUpdate
) -> CyclePublic:
    _require_admin(actor)
    cycle = await _cycle(session, actor, cycle_id)
    changes = data.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(cycle, key, value)
    _check_dates(cycle.starts_on, cycle.ends_on)
    await flush_or_conflict(session, DUPLICATE_CYCLE)
    return _cycle_public(cycle)


async def delete_cycle(session: AsyncSession, actor: User, cycle_id: uuid.UUID) -> None:
    _require_admin(actor)
    cycle = await _cycle(session, actor, cycle_id)
    used = (
        await session.execute(
            select(func.count()).select_from(Objective).where(Objective.cycle_id == cycle.id)
        )
    ).scalar_one()
    if used:
        raise ProblemError(409, "The cycle has objectives. Delete them first, or close the cycle.")
    await session.delete(cycle)
    await session.flush()


# --- the overview --------------------------------------------------------------------------------


async def overview(
    session: AsyncSession,
    actor: User,
    cycle_id: uuid.UUID,
    *,
    owner_id: uuid.UUID | None = None,
    level: OkrLevel | None = None,
    department_id: uuid.UUID | None = None,
    kr_status: list[KrStatus] | None = None,
    mine: bool = False,
) -> Overview:
    """The objectives of a cycle that the person may see, each with its key results.

    `kr_status` keeps only the key results in these states (and the objectives that still have
    one): that is the "at risk" view. `mine` keeps what the person owns or works on.
    """
    cycle = await _cycle(session, actor, cycle_id)
    rows = (
        (
            await session.execute(
                select(Objective)
                .where(Objective.cycle_id == cycle.id)
                .order_by(Objective.position, Objective.created_at, Objective.id)
            )
        )
        .scalars()
        .all()
    )
    book = await _book(session, list(rows))
    await _load_tasks(session, actor, book)
    only = set(kr_status) if kr_status else None

    def works_on(person: uuid.UUID, objective: Objective) -> bool:
        return objective.owner_id == person or any(
            kr.owner_id == person for kr in book.key_results.get(objective.id, [])
        )

    shown: list[ObjectivePublic] = []
    for objective in rows:
        if not can_see(actor, objective, book):
            continue
        if level is not None and objective.level != level:
            continue
        if department_id is not None and objective.department_id != department_id:
            continue
        if owner_id is not None and not works_on(owner_id, objective):
            continue
        if mine and not works_on(actor.id, objective):
            continue
        public = _objective_public(actor, objective, book, only)
        if only is not None and not public.key_results:
            continue
        shown.append(public)

    krs = [kr for o in shown for kr in o.key_results]
    measured = [o.progress for o in shown if o.progress is not None]
    summary = OverviewSummary(
        objectives=len(shown),
        key_results=len(krs),
        progress=round(sum(measured) / len(measured), 4) if measured else None,
        on_track=sum(1 for kr in krs if kr.status == KrStatus.ON_TRACK),
        at_risk=sum(1 for kr in krs if kr.status == KrStatus.AT_RISK),
        off_track=sum(1 for kr in krs if kr.status == KrStatus.OFF_TRACK),
        reviewed=sum(1 for o in shown if o.score is not None),
    )
    return Overview(cycle=_cycle_public(cycle), objectives=shown, summary=summary)


async def get_objective(
    session: AsyncSession, actor: User, objective_id: uuid.UUID
) -> ObjectivePublic:
    return await _public_one(session, actor, objective_id)


# --- objectives ----------------------------------------------------------------------------------


async def _department(session: AsyncSession, actor: User, department_id: uuid.UUID) -> Department:
    department = (
        await session.execute(
            select(Department).where(
                Department.id == department_id,
                Department.organization_id == actor.organization_id,
            )
        )
    ).scalar_one_or_none()
    if department is None:
        raise _invalid("department_id", "The department does not exist.")
    return department


async def _check_parent(
    session: AsyncSession,
    actor: User,
    *,
    cycle_id: uuid.UUID,
    parent_id: uuid.UUID,
    level: OkrLevel,
    own_id: uuid.UUID | None,
) -> None:
    """What an objective supports: one of the same cycle the person sees, of the same level or
    above, and never itself or one of its own descendants (no loops)."""
    if own_id is not None and parent_id == own_id:
        raise _invalid("parent_id", "An objective cannot support itself.")
    try:
        parent, _ = await _objective(session, actor, parent_id)
    except ProblemError:
        raise _invalid("parent_id", "The objective to support does not exist.") from None
    if parent.cycle_id != cycle_id:
        raise _invalid("parent_id", "It must be an objective of the same cycle.")
    if LEVEL_RANK[parent.level] > LEVEL_RANK[level]:
        raise _invalid("parent_id", "An objective supports one of its own level or above.")
    # Walk up from the parent: meeting this objective again would close a loop.
    seen = {parent.id}
    current = parent
    while own_id is not None and current.parent_id is not None:
        if current.parent_id == own_id:
            raise _invalid("parent_id", "That objective already supports this one.")
        if current.parent_id in seen:
            break
        seen.add(current.parent_id)
        current = (
            await session.execute(select(Objective).where(Objective.id == current.parent_id))
        ).scalar_one()


async def _next_position(session: AsyncSession, stmt: Any) -> int:
    last = (await session.execute(stmt)).scalar_one_or_none()
    return 0 if last is None else int(last) + 1


async def _check_level(
    session: AsyncSession,
    actor: User,
    *,
    level: OkrLevel,
    department_id: uuid.UUID | None,
    owner_id: uuid.UUID,
) -> Department | None:
    """Who may make an objective of this level, and for whom. Returns its department."""
    if level == OkrLevel.DEPARTMENT:
        if department_id is None:
            raise _invalid("department_id", "A department objective needs its department.")
        department = await _department(session, actor, department_id)
        if not is_org_admin(actor) and department.head_user_id != actor.id:
            raise ProblemError(
                403, "Only an admin or the head of the department can make its objectives."
            )
        return department
    if department_id is not None:
        raise _invalid("department_id", "Only a department objective has a department.")
    if level == OkrLevel.COMPANY:
        if not is_org_admin(actor):
            raise ProblemError(403, "Only an admin can make objectives of the company.")
    elif owner_id != actor.id and not is_org_admin(actor):
        raise ProblemError(403, "A personal objective is made for yourself, or by an admin.")
    return None


async def create_objective(
    session: AsyncSession, actor: User, data: ObjectiveCreate
) -> ObjectivePublic:
    cycle = await _cycle(session, actor, data.cycle_id)
    if cycle.status == CycleStatus.CLOSED:
        raise ProblemError(409, CLOSED)
    owner_id = data.owner_id or actor.id
    if owner_id != actor.id:
        await _person(session, actor, owner_id, "owner_id")
    await _check_level(
        session, actor, level=data.level, department_id=data.department_id, owner_id=owner_id
    )
    if data.parent_id is not None:
        await _check_parent(
            session,
            actor,
            cycle_id=cycle.id,
            parent_id=data.parent_id,
            level=data.level,
            own_id=None,
        )
    objective = Objective(
        organization_id=actor.organization_id,
        cycle_id=cycle.id,
        title=data.title,
        description=data.description,
        owner_id=owner_id,
        level=data.level,
        department_id=data.department_id,
        parent_id=data.parent_id,
        is_private=data.is_private,
        position=await _next_position(
            session,
            select(func.max(Objective.position)).where(Objective.cycle_id == cycle.id),
        ),
        created_by=actor.id,
    )
    session.add(objective)
    await session.flush()
    return await _public_one(session, actor, objective.id)


async def update_objective(
    session: AsyncSession, actor: User, objective_id: uuid.UUID, data: ObjectiveUpdate
) -> ObjectivePublic:
    objective, book = await _objective(session, actor, objective_id)
    if not can_edit(actor, objective, book):
        raise ProblemError(403, FORBIDDEN)
    await _open_cycle(session, objective)
    sent = data.model_fields_set
    for name in ("title", "level", "is_private", "position"):
        if name in sent and getattr(data, name) is None:
            raise _invalid(name, "Cannot be empty.")

    owner_id = objective.owner_id
    if "owner_id" in sent:
        if data.owner_id is None:
            raise _invalid("owner_id", "Cannot be empty.")
        if not is_org_admin(actor):
            raise ProblemError(403, "Only an admin can give an objective to somebody else.")
        await _person(session, actor, data.owner_id, "owner_id")
        owner_id = data.owner_id

    level = data.level if "level" in sent and data.level is not None else objective.level
    department_id = data.department_id if "department_id" in sent else objective.department_id
    if "level" in sent and data.level != objective.level and not is_org_admin(actor):
        raise ProblemError(403, "Only an admin can change the level of an objective.")
    if {"level", "department_id", "owner_id"} & sent:
        await _check_level(
            session, actor, level=level, department_id=department_id, owner_id=owner_id
        )
    parent_id = data.parent_id if "parent_id" in sent else objective.parent_id
    if parent_id is not None and ({"parent_id", "level"} & sent):
        await _check_parent(
            session,
            actor,
            cycle_id=objective.cycle_id,
            parent_id=parent_id,
            level=level,
            own_id=objective.id,
        )

    objective.owner_id = owner_id
    objective.level = level
    objective.department_id = department_id
    objective.parent_id = parent_id
    if "title" in sent and data.title is not None:
        objective.title = data.title
    if "description" in sent:
        objective.description = data.description
    if "is_private" in sent and data.is_private is not None:
        objective.is_private = data.is_private
    if "position" in sent and data.position is not None:
        objective.position = data.position
    await session.flush()
    await session.refresh(objective)
    return await _public_one(session, actor, objective.id)


async def delete_objective(session: AsyncSession, actor: User, objective_id: uuid.UUID) -> None:
    objective, book = await _objective(session, actor, objective_id)
    if not can_edit(actor, objective, book):
        raise ProblemError(403, FORBIDDEN)
    await _open_cycle(session, objective)
    await session.execute(delete(Objective).where(Objective.id == objective.id))
    await session.flush()


# --- key results ---------------------------------------------------------------------------------


def _check_span(start: float, target: float) -> None:
    if start == target:
        raise _invalid("target_value", "The target must differ from the start value.")


async def create_key_result(
    session: AsyncSession, actor: User, objective_id: uuid.UUID, data: KeyResultCreate
) -> ObjectivePublic:
    objective, book = await _objective(session, actor, objective_id)
    if not can_edit(actor, objective, book):
        raise ProblemError(403, FORBIDDEN)
    await _open_cycle(session, objective)
    _check_span(data.start_value, data.target_value)
    if len(book.key_results.get(objective.id, [])) >= MAX_KEY_RESULTS:
        raise ProblemError(409, f"An objective has at most {MAX_KEY_RESULTS} key results.")
    owner_id = data.owner_id or objective.owner_id
    if owner_id != objective.owner_id:
        await _person(session, actor, owner_id, "owner_id")
    start = _decimal(data.start_value)
    session.add(
        KeyResult(
            objective_id=objective.id,
            title=data.title,
            owner_id=owner_id,
            unit=data.unit,
            start_value=start,
            target_value=_decimal(data.target_value),
            current_value=start,
            position=(
                data.position
                if data.position is not None
                else await _next_position(
                    session,
                    select(func.max(KeyResult.position)).where(
                        KeyResult.objective_id == objective.id
                    ),
                )
            ),
        )
    )
    await session.flush()
    return await _public_one(session, actor, objective.id)


async def update_key_result(
    session: AsyncSession, actor: User, key_result_id: uuid.UUID, data: KeyResultUpdate
) -> ObjectivePublic:
    kr, objective, book = await _key_result(session, actor, key_result_id)
    if not can_edit(actor, objective, book):
        raise ProblemError(403, FORBIDDEN)
    await _open_cycle(session, objective)
    start = data.start_value if data.start_value is not None else float(kr.start_value)
    target = data.target_value if data.target_value is not None else float(kr.target_value)
    _check_span(start, target)
    if data.owner_id is not None and data.owner_id != kr.owner_id:
        await _person(session, actor, data.owner_id, "owner_id")
        kr.owner_id = data.owner_id
    if data.title is not None:
        kr.title = data.title
    if data.unit is not None:
        kr.unit = data.unit
    if data.position is not None:
        kr.position = data.position
    kr.start_value, kr.target_value = _decimal(start), _decimal(target)
    await session.flush()
    return await _public_one(session, actor, objective.id)


async def delete_key_result(session: AsyncSession, actor: User, key_result_id: uuid.UUID) -> None:
    kr, objective, book = await _key_result(session, actor, key_result_id)
    if not can_edit(actor, objective, book):
        raise ProblemError(403, FORBIDDEN)
    await _open_cycle(session, objective)
    await session.delete(kr)
    await session.flush()


# --- check-ins -----------------------------------------------------------------------------------


async def check_in(
    session: AsyncSession, actor: User, key_result_id: uuid.UUID, data: CheckInCreate
) -> ObjectivePublic:
    """The weekly update of a key result: the new value, how it feels, a note. Kept as history."""
    kr, objective, book = await _key_result(session, actor, key_result_id)
    if not can_check_in(actor, kr, objective, book):
        raise ProblemError(403, FORBIDDEN)
    await _open_cycle(session, objective)
    status = data.status or kr.status
    kr.current_value = _decimal(data.value)
    kr.status = status
    session.add(
        CheckIn(
            key_result_id=kr.id,
            author_id=actor.id,
            value=kr.current_value,
            status=status,
            note=data.note or None,
        )
    )
    kr.updated_at = datetime.now(UTC)
    await session.flush()
    return await _public_one(session, actor, objective.id)


async def list_check_ins(
    session: AsyncSession, actor: User, key_result_id: uuid.UUID
) -> list[CheckInPublic]:
    kr, _, _ = await _key_result(session, actor, key_result_id)
    rows = (
        (
            await session.execute(
                select(CheckIn)
                .where(CheckIn.key_result_id == kr.id)
                .order_by(CheckIn.created_at.desc(), CheckIn.id)
                .limit(MAX_CHECK_INS)
            )
        )
        .scalars()
        .all()
    )
    people = {
        u.id: u
        for u in (
            await session.execute(select(User).where(User.id.in_({r.author_id for r in rows})))
        ).scalars()
    }
    book = Book({}, users=people)
    return [
        CheckInPublic(
            id=row.id,
            key_result_id=row.key_result_id,
            author=_user_ref(book, row.author_id),
            value=float(row.value),
            status=row.status,
            note=row.note,
            created_at=row.created_at,
        )
        for row in rows
    ]


# --- the review ----------------------------------------------------------------------------------


def _apply_review(target: Objective | KeyResult, data: ReviewUpdate) -> None:
    sent = data.model_fields_set
    if "score" in sent:
        target.score = None if data.score is None else _decimal(round(data.score, 2))
    if "merits" in sent:
        target.merits = data.merits or None
    if "to_improve" in sent:
        target.to_improve = data.to_improve or None


async def review_objective(
    session: AsyncSession, actor: User, objective_id: uuid.UUID, data: ReviewUpdate
) -> ObjectivePublic:
    objective, book = await _objective(session, actor, objective_id)
    if not can_review(actor, objective, book):
        raise ProblemError(
            403,
            "Only an admin, the manager of the owner, or the owner of the objective it supports "
            "can review it.",
        )
    _apply_review(objective, data)
    await session.flush()
    return await _public_one(session, actor, objective.id)


async def review_key_result(
    session: AsyncSession, actor: User, key_result_id: uuid.UUID, data: ReviewUpdate
) -> ObjectivePublic:
    kr, objective, book = await _key_result(session, actor, key_result_id)
    if not can_review(actor, objective, book):
        raise ProblemError(
            403,
            "Only an admin, the manager of the owner, or the owner of the objective it supports "
            "can review it.",
        )
    _apply_review(kr, data)
    await session.flush()
    return await _public_one(session, actor, objective.id)


# --- departments (a department objective names one) ----------------------------------------------


async def list_departments(session: AsyncSession, actor: User) -> list[OkrDepartment]:
    """The departments of the organization, by name. Everybody may read the names (they are
    shown on the objectives anyway); `can_create` says for which ones the caller may make
    objectives."""
    rows = await session.execute(
        select(Department)
        .where(Department.organization_id == actor.organization_id)
        .order_by(func.lower(Department.name), Department.id)
    )
    admin = is_org_admin(actor)
    return [
        OkrDepartment(id=d.id, name=d.name, can_create=admin or d.head_user_id == actor.id)
        for d in rows.scalars()
    ]
