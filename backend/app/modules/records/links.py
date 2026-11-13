"""Links between records, stored in both directions (docs/erd.md 3.5).

A link from record A to record B in field F is two rows: (F, A, B) and (F', B, A) where F' is
the mirror field. Both are written in the same transaction as the record that changed.
"""

import uuid
from collections import defaultdict

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.fields.models import Field, FieldSemantic
from app.modules.records.models import Record, RecordLink, RecordViewer
from app.modules.users.models import User

MAX_TREE_DEPTH = 100


def target_table_id(field: Field) -> uuid.UUID:
    return uuid.UUID(str(field.config["table_id"]))


def inverse_field_id(field: Field) -> uuid.UUID:
    return uuid.UUID(str(field.config["inverse_field_id"]))


def is_multiple(field: Field) -> bool:
    return bool(field.config.get("multiple", True))


async def check_targets(
    session: AsyncSession,
    actor: User,
    field: Field,
    source: Record | None,
    ids: list[uuid.UUID],
    *,
    sees_all: bool,
) -> None:
    """Every target must be a live record of the linked table that the actor may see.

    A target the actor cannot see is reported exactly like one that does not exist, so a link
    cannot be used to find out which record ids exist.
    """
    if not ids:
        return
    if source is not None and source.id in ids:
        raise ProblemError(422, "A record cannot be linked to itself.")
    found = set(
        (
            await session.execute(
                select(Record.id).where(
                    Record.id.in_(ids),
                    Record.table_id == target_table_id(field),
                    Record.deleted_at.is_(None),
                )
            )
        ).scalars()
    )
    if not sees_all and found:
        found = set(
            (
                await session.execute(
                    select(RecordViewer.record_id).where(
                        RecordViewer.user_id == actor.id, RecordViewer.record_id.in_(found)
                    )
                )
            ).scalars()
        )
    if found != set(ids):
        raise ProblemError(422, "One or more linked records do not exist.")


async def check_no_cycle(
    session: AsyncSession, field: Field, record_id: uuid.UUID, new_targets: list[uuid.UUID]
) -> None:
    """A task cannot become its own ancestor (parent chains must not loop)."""
    if field.semantic not in (FieldSemantic.PARENT, FieldSemantic.SUBTASKS) or not new_targets:
        return
    # Walk "upwards" from the new targets. For a parent field the targets are the new parents,
    # for a subtasks field the new targets are children, so walk up from this record instead.
    parent_field_id = (
        field.id if field.semantic == FieldSemantic.PARENT else inverse_field_id(field)
    )
    if field.semantic == FieldSemantic.PARENT:
        starts, forbidden = new_targets, record_id
    else:
        starts, forbidden = [record_id], None
    frontier = set(starts)
    seen: set[uuid.UUID] = set()
    for _ in range(MAX_TREE_DEPTH):
        if not frontier:
            return
        if forbidden is not None and forbidden in frontier:
            raise ProblemError(422, "A task cannot be placed under one of its own subtasks.")
        if forbidden is None and frontier & set(new_targets):
            raise ProblemError(422, "A task cannot be placed under one of its own subtasks.")
        seen |= frontier
        rows = await session.execute(
            select(RecordLink.target_record_id).where(
                RecordLink.field_id == parent_field_id, RecordLink.source_record_id.in_(frontier)
            )
        )
        frontier = set(rows.scalars()) - seen
    raise ProblemError(422, "The task tree is too deep.")


async def current_targets(
    session: AsyncSession, field: Field, record_id: uuid.UUID
) -> list[uuid.UUID]:
    rows = await session.execute(
        select(RecordLink.target_record_id).where(
            RecordLink.field_id == field.id, RecordLink.source_record_id == record_id
        )
    )
    return list(rows.scalars())


async def set_targets(
    session: AsyncSession, field: Field, record_id: uuid.UUID, targets: list[uuid.UUID]
) -> None:
    """Make the links of a record in a field equal `targets`, in both directions."""
    inverse = inverse_field_id(field)
    before = set(await current_targets(session, field, record_id))
    after = set(targets)

    removed = before - after
    if removed:
        await _delete_pairs(session, field.id, inverse, [(record_id, t) for t in removed])

    added = after - before
    if not added:
        return
    inverse_field = await session.get(Field, inverse)
    assert inverse_field is not None
    inverse_multiple = bool(inverse_field.config.get("multiple", True))
    if not inverse_multiple:
        # The other side takes one record at most (a task has one parent): whatever it pointed
        # to before is replaced.
        rows = await session.execute(
            select(RecordLink.source_record_id, RecordLink.target_record_id).where(
                RecordLink.field_id == inverse, RecordLink.source_record_id.in_(added)
            )
        )
        stale = [(s, t) for s, t in rows.all() if t != record_id]
        if stale:
            await _delete_pairs(session, inverse, field.id, stale)
    for target in added:
        session.add(
            RecordLink(field_id=field.id, source_record_id=record_id, target_record_id=target)
        )
        session.add(
            RecordLink(field_id=inverse, source_record_id=target, target_record_id=record_id)
        )
    await session.flush()


async def _delete_pairs(
    session: AsyncSession,
    field_id: uuid.UUID,
    inverse_id: uuid.UUID,
    pairs: list[tuple[uuid.UUID, uuid.UUID]],
) -> None:
    """Delete (field, a, b) and its mirror (inverse, b, a) for each pair."""
    conditions = []
    for source, target in pairs:
        conditions.append(
            and_(
                RecordLink.field_id == field_id,
                RecordLink.source_record_id == source,
                RecordLink.target_record_id == target,
            )
        )
        conditions.append(
            and_(
                RecordLink.field_id == inverse_id,
                RecordLink.source_record_id == target,
                RecordLink.target_record_id == source,
            )
        )
    await session.execute(delete(RecordLink).where(or_(*conditions)))


async def load_targets(
    session: AsyncSession,
    record_ids: list[uuid.UUID],
    field_ids: list[uuid.UUID],
    *,
    actor: User,
    sees_all: bool,
) -> dict[tuple[uuid.UUID, uuid.UUID], list[uuid.UUID]]:
    """(record, field) -> ids of the records it links to, for a whole page at once.

    Records in the trash are left out, and so are records the actor may not see: a link must
    never show data (even an id) that the person could not open directly.
    """
    result: dict[tuple[uuid.UUID, uuid.UUID], list[uuid.UUID]] = defaultdict(list)
    if not record_ids or not field_ids:
        return result
    query = (
        select(RecordLink.source_record_id, RecordLink.field_id, RecordLink.target_record_id)
        .join(Record, Record.id == RecordLink.target_record_id)
        .where(
            RecordLink.source_record_id.in_(record_ids),
            RecordLink.field_id.in_(field_ids),
            Record.deleted_at.is_(None),
        )
        .order_by(Record.created_at, Record.id)
    )
    if not sees_all:
        query = query.where(
            RecordLink.target_record_id.in_(
                select(RecordViewer.record_id).where(RecordViewer.user_id == actor.id)
            )
        )
    for source, field_id, target in (await session.execute(query)).all():
        result[(source, field_id)].append(target)
    return result
