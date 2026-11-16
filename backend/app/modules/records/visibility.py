"""The only code that writes `record_viewers` (ADR 0003).

A record is visible to its creator, to everybody named in a user field that grants view access,
and to the members of the sheet of each person named in the assignee column (a sheet shows its
owner's records). The table is rebuilt from the record's own data every time the record changes,
in the same transaction, so it cannot drift from `records.data`. `rebuild_table` repairs a whole
table (for example after a field that grants view access was deleted).
"""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fields.models import Field, FieldType
from app.modules.records.models import (
    CREATOR_SOURCE,
    SHEET_SOURCE_PREFIX,
    Record,
    RecordViewer,
    ViewerReason,
)
from app.modules.sheets import access as sheet_access
from app.modules.sheets.models import Sheet, SheetMember

ViewerKey = tuple[uuid.UUID, str]


def wanted_viewers(record: Record, fields: list[Field]) -> dict[ViewerKey, uuid.UUID | None]:
    """(user, source) -> the field that names them (None for the creator)."""
    wanted: dict[ViewerKey, uuid.UUID | None] = {(record.created_by, CREATOR_SOURCE): None}
    for field in fields:
        if field.type != FieldType.USER or not field.grants_view or field.deleted_at is not None:
            continue
        for raw in record.data.get(str(field.id), []):
            wanted[(uuid.UUID(str(raw)), str(field.id))] = field.id
    return wanted


async def _with_sheets(
    session: AsyncSession, record: Record, fields: list[Field]
) -> dict[ViewerKey, uuid.UUID | None]:
    """`wanted_viewers` plus the members of the live sheets that show the record."""
    wanted = wanted_viewers(record, fields)
    owners = sheet_access.owners_of(record, fields)
    if not owners:
        return wanted
    rows = (
        await session.execute(
            select(SheetMember.user_id, Sheet.id)
            .join(Sheet, Sheet.id == SheetMember.sheet_id)
            .where(
                Sheet.table_id == record.table_id,
                Sheet.archived_at.is_(None),
                Sheet.owner_id.in_(owners),
            )
        )
    ).all()
    for user_id, sheet_id in rows:
        wanted[(user_id, f"{SHEET_SOURCE_PREFIX}{sheet_id}")] = None
    return wanted


def _row(record_id: uuid.UUID, key: ViewerKey, field_id: uuid.UUID | None) -> RecordViewer:
    user_id, source_key = key
    if source_key == CREATOR_SOURCE:
        reason = ViewerReason.CREATOR
    elif source_key.startswith(SHEET_SOURCE_PREFIX):
        reason = ViewerReason.SHEET
    else:
        reason = ViewerReason.FIELD
    return RecordViewer(
        record_id=record_id,
        user_id=user_id,
        source_key=source_key,
        reason=reason,
        source_field_id=field_id,
    )


async def rebuild_record(session: AsyncSession, record: Record, fields: list[Field]) -> None:
    """Make `record_viewers` of one record match its data. Adds and removes only the difference."""
    wanted = await _with_sheets(session, record, fields)
    result = await session.execute(select(RecordViewer).where(RecordViewer.record_id == record.id))
    current = {(row.user_id, row.source_key): row for row in result.scalars()}

    for key, row in current.items():
        if key not in wanted:
            await session.delete(row)
    for key, field_id in wanted.items():
        if key not in current:
            session.add(_row(record.id, key, field_id))
    await session.flush()


async def rebuild_table(session: AsyncSession, table_id: uuid.UUID, fields: list[Field]) -> int:
    """Rebuild the viewers of every record of a table (live and in the trash). Returns the count.

    The table is processed in batches, so a large table does not need to fit in memory.
    """
    ids = (
        (await session.execute(select(Record.id).where(Record.table_id == table_id)))
        .scalars()
        .all()
    )
    for start in range(0, len(ids), 500):
        batch = ids[start : start + 500]
        await session.execute(delete(RecordViewer).where(RecordViewer.record_id.in_(batch)))
        records = (
            (await session.execute(select(Record).where(Record.id.in_(batch)))).scalars().all()
        )
        for record in records:
            for key, field_id in (await _with_sheets(session, record, fields)).items():
                session.add(_row(record.id, key, field_id))
        await session.flush()
        session.expire_all()
    return len(ids)
