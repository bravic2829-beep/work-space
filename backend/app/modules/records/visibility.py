"""The only code that writes `record_viewers` (ADR 0003).

A record is visible to its creator and to everybody named in a user field that grants view
access. The table is rebuilt from the record's own data every time the record changes, in the
same transaction, so it cannot drift from `records.data`. `rebuild_table` repairs a whole table
(for example after a field that grants view access was deleted).
"""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fields.models import Field, FieldType
from app.modules.records.models import CREATOR_SOURCE, Record, RecordViewer, ViewerReason

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


async def rebuild_record(session: AsyncSession, record: Record, fields: list[Field]) -> None:
    """Make `record_viewers` of one record match its data. Adds and removes only the difference."""
    wanted = wanted_viewers(record, fields)
    result = await session.execute(select(RecordViewer).where(RecordViewer.record_id == record.id))
    current = {(row.user_id, row.source_key): row for row in result.scalars()}

    for key, row in current.items():
        if key not in wanted:
            await session.delete(row)
    for (user_id, source_key), field_id in wanted.items():
        if (user_id, source_key) not in current:
            session.add(
                RecordViewer(
                    record_id=record.id,
                    user_id=user_id,
                    source_key=source_key,
                    reason=ViewerReason.CREATOR if field_id is None else ViewerReason.FIELD,
                    source_field_id=field_id,
                )
            )
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
            for (user_id, source_key), field_id in wanted_viewers(record, fields).items():
                session.add(
                    RecordViewer(
                        record_id=record.id,
                        user_id=user_id,
                        source_key=source_key,
                        reason=ViewerReason.CREATOR if field_id is None else ViewerReason.FIELD,
                        source_field_id=field_id,
                    )
                )
        await session.flush()
        session.expire_all()
    return len(ids)
