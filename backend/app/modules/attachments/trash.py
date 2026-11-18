"""Recovery and scheduled cleanup of separately deleted files."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import ProblemError
from app.core.pagination import Page, check_limit, parse_time_cursor, time_cursor
from app.modules.activity.log import record_activity
from app.modules.activity.models import ActivityAction
from app.modules.attachments import service, storage
from app.modules.attachments.models import Attachment, TrashedAttachment
from app.modules.fields.models import FieldAccessLevel, FieldType
from app.modules.fields.titles import title_field
from app.modules.permissions.service import is_org_admin
from app.modules.records import service as records
from app.modules.users.models import User

logger = logging.getLogger(__name__)
SWEEP_INTERVAL = 3600
BATCH_SIZE = 100


class OriginalLocation(BaseModel):
    table_id: uuid.UUID
    table_name: str
    record_name: str | None
    field_name: str


class FileTrashItem(BaseModel):
    id: uuid.UUID
    name: str
    deleted_by: str
    deleted_at: datetime
    purge_at: datetime
    original: OriginalLocation | None
    can_restore: bool
    can_delete_forever: bool


async def _original(
    session: AsyncSession, actor: User, file: TrashedAttachment
) -> tuple[OriginalLocation | None, bool]:
    try:
        record, context = await records.load_record(session, actor, file.record_id)
    except ProblemError as error:
        if error.status not in (403, 404):
            raise
        return None, False
    fields = await records.fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id, record=record
    )
    column = next(
        (
            (f, access)
            for f, access in fields
            if f.id == file.field_id
            and f.type == FieldType.ATTACHMENT
            and access != FieldAccessLevel.HIDDEN
        ),
        None,
    )
    if column is None:
        return None, False
    title = title_field([f for f, _ in fields])
    visible_ids = {f.id for f, access in fields if access != FieldAccessLevel.HIDDEN}
    name = record.data.get(str(title.id)) if title is not None and title.id in visible_ids else None
    return OriginalLocation(
        table_id=context.table.id,
        table_name=context.table.name,
        record_name=str(name) if name is not None else None,
        field_name=column[0].name,
    ), column[1] == FieldAccessLevel.EDIT


async def list_files(
    session: AsyncSession, actor: User, *, limit: int, cursor: str | None
) -> Page[FileTrashItem]:
    check_limit(limit)
    admin = is_org_admin(actor)
    now = datetime.now(UTC)
    key = tuple_(TrashedAttachment.deleted_at, TrashedAttachment.id)
    query = (
        select(TrashedAttachment, User.full_name)
        .join(User, User.id == TrashedAttachment.deleted_by)
        .where(
            TrashedAttachment.organization_id == actor.organization_id,
            TrashedAttachment.purge_at > now,
        )
        .order_by(TrashedAttachment.deleted_at.desc(), TrashedAttachment.id.desc())
        .limit(limit + 1)
    )
    if not admin:
        query = query.where(TrashedAttachment.deleted_by == actor.id)

    after = parse_time_cursor(cursor)
    items: list[FileTrashItem] = []
    while True:
        rows = (
            await session.execute(query if after is None else query.where(key < tuple_(*after)))
        ).all()
        for file, deleted_by in rows:
            original, can_restore = await _original(session, actor, file)
            if original is None and not admin:
                continue
            if len(items) == limit:
                last = items[-1]
                return Page[FileTrashItem](
                    items=items, next_cursor=time_cursor(last.deleted_at, last.id)
                )
            items.append(
                FileTrashItem(
                    id=file.id,
                    name=file.name,
                    deleted_by=deleted_by,
                    deleted_at=file.deleted_at,
                    purge_at=file.purge_at,
                    original=original,
                    can_restore=can_restore,
                    can_delete_forever=admin,
                )
            )
        if len(rows) < limit + 1:
            return Page[FileTrashItem](items=items, next_cursor=None)
        file = rows[-1][0]
        after = (file.deleted_at, file.id)


async def _load_file(
    session: AsyncSession, actor: User, file_id: uuid.UUID, *, lock: bool = False
) -> TrashedAttachment:
    query = select(TrashedAttachment).where(
        TrashedAttachment.id == file_id,
        TrashedAttachment.organization_id == actor.organization_id,
    )
    if not is_org_admin(actor):
        query = query.where(TrashedAttachment.deleted_by == actor.id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    file = (await session.execute(query)).scalar_one_or_none()
    if file is None or file.purge_at <= datetime.now(UTC):
        raise ProblemError(404, "The file is not in the trash.")
    return file


async def restore(session: AsyncSession, actor: User, file_id: uuid.UUID, root: str) -> None:
    file = await _load_file(session, actor, file_id)
    # Lock the task first, as the normal upload and removal paths do.
    record, column = await service.load_column(
        session, actor, file.record_id, file.field_id, edit=True, for_update=True
    )
    file = await _load_file(session, actor, file_id, lock=True)
    await service.check_capacity(session, record.id, column.id)
    if not storage.path_for(root, file.storage_key).is_file():
        raise ProblemError(404, "The file is no longer available.")
    session.add(
        Attachment(
            id=file.id,
            record_id=record.id,
            field_id=column.id,
            name=file.name,
            content_type=file.content_type,
            size_bytes=file.size_bytes,
            storage_key=file.storage_key,
            uploaded_by=file.uploaded_by,
            created_at=file.created_at,
        )
    )
    await session.delete(file)
    record.updated_at = datetime.now(UTC)
    await session.flush()
    await record_activity(
        session,
        record_id=record.id,
        actor_id=actor.id,
        action=ActivityAction.ATTACHMENT_ADDED,
        changes={str(column.id): {"from": None, "to": file.name}},
        note="Restored from Trash.",
    )


async def _admin_file(
    session: AsyncSession, actor: User, file_id: uuid.UUID, *, lock: bool = False
) -> TrashedAttachment:
    file = await _load_file(session, actor, file_id, lock=lock)
    if not is_org_admin(actor):
        raise ProblemError(
            403, "Only an organization admin can download or permanently delete trashed files."
        )
    return file


async def for_download(
    session: AsyncSession, actor: User, file_id: uuid.UUID, root: str
) -> tuple[TrashedAttachment, Path]:
    file = await _admin_file(session, actor, file_id)
    path = storage.path_for(root, file.storage_key)
    if not path.is_file():
        raise ProblemError(404, "The file is no longer available.")
    return file, path


async def delete_forever(session: AsyncSession, actor: User, file_id: uuid.UUID) -> None:
    file = await _admin_file(session, actor, file_id, lock=True)
    # Close recovery immediately and keep the storage key for reliable cleanup.
    file.purge_at = datetime.now(UTC)


async def purge_expired(sessions: async_sessionmaker[AsyncSession], root: str) -> None:
    cutoff = datetime.now(UTC)
    after: tuple[datetime, uuid.UUID] | None = None
    key = tuple_(TrashedAttachment.purge_at, TrashedAttachment.id)
    query = (
        select(TrashedAttachment)
        .where(TrashedAttachment.purge_at <= cutoff)
        .order_by(TrashedAttachment.purge_at, TrashedAttachment.id)
        .limit(BATCH_SIZE)
        .with_for_update(skip_locked=True)
    )
    while True:
        async with sessions.begin() as session:
            batch = (
                await session.scalars(query if after is None else query.where(key > tuple_(*after)))
            ).all()
            for file in batch:
                try:
                    await asyncio.to_thread(storage.remove, root, file.storage_key)
                except OSError:
                    logger.exception("Could not purge trashed attachment %s", file.id)
                    continue
                await session.delete(file)
            if len(batch) < BATCH_SIZE:
                return
            after = (batch[-1].purge_at, batch[-1].id)


async def run_cleanup(sessions: async_sessionmaker[AsyncSession], root: str) -> None:
    while True:
        try:
            await purge_expired(sessions, root)
        except Exception:
            logger.exception("Could not clean up the file trash")
        await asyncio.sleep(SWEEP_INTERVAL)
