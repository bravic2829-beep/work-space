import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.attachments.models import Attachment


def public(attachment: Attachment) -> dict[str, Any]:
    """How a file appears in a record: what the person needs to show and download it."""
    return {
        "id": str(attachment.id),
        "name": attachment.name,
        "size": attachment.size_bytes,
        "content_type": attachment.content_type,
    }


async def load_for_records(
    session: AsyncSession, record_ids: list[uuid.UUID], field_ids: list[uuid.UUID]
) -> dict[tuple[uuid.UUID, uuid.UUID], list[dict[str, Any]]]:
    """(record, column) -> its files, oldest first. One query for a whole page of records."""
    if not record_ids or not field_ids:
        return {}
    rows = (
        (
            await session.execute(
                select(Attachment)
                .where(Attachment.record_id.in_(record_ids), Attachment.field_id.in_(field_ids))
                .order_by(Attachment.created_at, Attachment.id)
            )
        )
        .scalars()
        .all()
    )
    found: dict[tuple[uuid.UUID, uuid.UUID], list[dict[str, Any]]] = {}
    for attachment in rows:
        found.setdefault((attachment.record_id, attachment.field_id), []).append(public(attachment))
    return found


async def keys_of_records(session: AsyncSession, record_ids: list[uuid.UUID]) -> list[str]:
    """The storage keys of every file of these records (to delete the files with the rows)."""
    if not record_ids:
        return []
    result = await session.execute(
        select(Attachment.storage_key).where(Attachment.record_id.in_(record_ids))
    )
    return list(result.scalars())
