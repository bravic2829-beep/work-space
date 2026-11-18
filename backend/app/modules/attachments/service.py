"""Adding, downloading and removing the files of a task.

Who may do what follows the column the files are in, exactly like any other cell:
- see the file names and download: the column is visible to the person (not hidden);
- add or remove: the person may edit that column on that task (a workspace editor, the manager or
  an editor of its sheet, an organization admin; a column rule can narrow this, never widen it).
A column hidden from the person does not exist for them: 404, never "forbidden".
"""

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import ProblemError
from app.modules.activity.log import record_activity
from app.modules.activity.models import ActivityAction
from app.modules.attachments import storage
from app.modules.attachments.models import Attachment, TrashedAttachment
from app.modules.fields.models import Field, FieldAccessLevel, FieldType
from app.modules.permissions.service import load_table_context
from app.modules.records import service as records
from app.modules.records.models import Record
from app.modules.records.schemas import RecordPublic
from app.modules.users.models import User

FORBIDDEN = "You do not have permission to do this."
TRASH_DAYS = 7


async def load_column(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    field_id: uuid.UUID,
    *,
    edit: bool,
    for_update: bool = False,
) -> tuple[Record, Field]:
    """The task and the files column, once the person may see (or edit) it."""
    record, context = await records.load_record(session, actor, record_id, for_update=for_update)
    fields = await records.fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id, record=record
    )
    found = next(
        ((f, level) for f, level in fields if f.id == field_id and f.type == FieldType.ATTACHMENT),
        None,
    )
    if found is None or found[1] == FieldAccessLevel.HIDDEN:
        raise ProblemError(404, "The files column does not exist.")
    if edit and found[1] != FieldAccessLevel.EDIT:
        raise ProblemError(403, FORBIDDEN)
    return record, found[0]


async def _render(session: AsyncSession, actor: User, record: Record) -> RecordPublic:
    context = await load_table_context(session, actor, record.table_id)
    fields = await records.fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id, record=record
    )
    return (
        await records.render(session, actor, context, [record], records.visible_columns(fields))
    )[0]


async def upload(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    field_id: uuid.UUID,
    raw_name: str,
    declared_size: int | None,
    chunks: AsyncIterator[bytes],
    settings: Settings,
) -> tuple[Record, RecordPublic]:
    """Keep one file in the column. The task's version does not change: files are not cells."""
    name = storage.clean_name(raw_name)  # before reading a single byte of the body
    limit = settings.attachment_max_bytes
    if declared_size is not None and declared_size > limit:
        raise ProblemError(413, f"The file is too big. The limit is {limit // 1_000_000} MB.")
    root = settings.attachments_dir
    key = storage.new_key()
    # Check permissions before reading the body, then lock only for the database write.
    record, column = await load_column(session, actor, record_id, field_id, edit=True)
    await check_capacity(session, record.id, column.id)
    session.expire(record)
    session.expire(column)
    size = await storage.save(root, key, chunks, limit)
    try:
        record, column = await load_column(
            session, actor, record_id, field_id, edit=True, for_update=True
        )
        await check_capacity(session, record.id, column.id)
        session.add(
            Attachment(
                record_id=record.id,
                field_id=column.id,
                name=name,
                content_type=storage.content_type_of(name),
                size_bytes=size,
                storage_key=key,
                uploaded_by=actor.id,
            )
        )
        record.updated_at = datetime.now(UTC)
        await session.flush()
        await record_activity(
            session,
            record_id=record.id,
            actor_id=actor.id,
            action=ActivityAction.ATTACHMENT_ADDED,
            changes={str(column.id): {"from": None, "to": name}},
        )
        await session.refresh(record)
        return record, await _render(session, actor, record)
    except BaseException:
        storage.remove(root, key)
        raise


async def check_capacity(session: AsyncSession, record_id: uuid.UUID, field_id: uuid.UUID) -> None:
    """Call with the task locked so uploads and restores share the same limit."""
    count = (
        await session.execute(
            select(func.count())
            .select_from(Attachment)
            .where(Attachment.record_id == record_id, Attachment.field_id == field_id)
        )
    ).scalar_one()
    if count >= storage.MAX_FILES_PER_CELL:
        raise ProblemError(409, f"At most {storage.MAX_FILES_PER_CELL} files fit in one column.")


async def _owned(
    session: AsyncSession, attachment_id: uuid.UUID, *, refresh: bool = False
) -> Attachment:
    attachment = await session.get(Attachment, attachment_id, populate_existing=refresh)
    if attachment is None:
        raise ProblemError(404, "The file does not exist.")
    return attachment


async def for_download(
    session: AsyncSession, actor: User, attachment_id: uuid.UUID, settings: Settings
) -> tuple[Attachment, Path]:
    """The file and where it is, for a person who may see the column it is in."""
    attachment = await _owned(session, attachment_id)
    await load_column(session, actor, attachment.record_id, attachment.field_id, edit=False)
    path = storage.path_for(settings.attachments_dir, attachment.storage_key)
    if not path.is_file():
        raise ProblemError(404, "The file is no longer available.")
    return attachment, path


async def remove(
    session: AsyncSession, actor: User, attachment_id: uuid.UUID
) -> tuple[Record, RecordPublic]:
    """Move the file's metadata to Trash. Its contents stay at the same storage key."""
    attachment = await _owned(session, attachment_id)
    record, column = await load_column(
        session, actor, attachment.record_id, attachment.field_id, edit=True, for_update=True
    )
    attachment = await _owned(session, attachment_id, refresh=True)
    now = datetime.now(UTC)
    session.add(
        TrashedAttachment(
            id=attachment.id,
            organization_id=actor.organization_id,
            record_id=record.id,
            field_id=column.id,
            name=attachment.name,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            storage_key=attachment.storage_key,
            uploaded_by=attachment.uploaded_by,
            created_at=attachment.created_at,
            deleted_by=actor.id,
            deleted_at=now,
            purge_at=now + timedelta(days=TRASH_DAYS),
        )
    )
    name = attachment.name
    await session.delete(attachment)
    record.updated_at = now
    await session.flush()
    await record_activity(
        session,
        record_id=record.id,
        actor_id=actor.id,
        action=ActivityAction.ATTACHMENT_REMOVED,
        changes={str(column.id): {"from": name, "to": None}},
    )
    await session.refresh(record)
    return record, await _render(session, actor, record)
