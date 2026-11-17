"""The steps every "change one task" action shares (report done, review, timer, hand over).

Each action loads and locks the record, checks that it is still at the version the caller saw,
writes new data with the next version, and answers with the record as the caller may see it.
What is checked in between (who may do it, what the data becomes) stays in the action itself.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import STALE_RECORD, ProblemError
from app.modules.fields.models import Field, FieldAccessLevel
from app.modules.permissions.service import TableContext
from app.modules.records import service
from app.modules.records.models import Record
from app.modules.records.schemas import RecordPublic
from app.modules.users.models import User


@dataclass
class Loaded:
    record: Record
    context: TableContext
    # Every column with the caller's access to it.
    fields: list[tuple[Field, FieldAccessLevel]]

    @property
    def columns(self) -> list[Field]:
        return [f for f, _ in self.fields]


async def load_locked(
    session: AsyncSession, actor: User, record_id: uuid.UUID, *, sheet_aware: bool = False
) -> Loaded:
    """A record the caller may see, locked for update, with the columns they may use.

    `sheet_aware`: a role on a sheet that shows the record counts towards column access.
    """
    record, context = await service.load_record(session, actor, record_id, for_update=True)
    fields = await service.fields_with_access(
        session,
        actor,
        context,
        is_creator=record.created_by == actor.id,
        record=record if sheet_aware else None,
    )
    return Loaded(record, context, fields)


def check_version(record: Record, if_match: str | None) -> None:
    """412 when somebody changed the record since the caller read it (428 without If-Match)."""
    if service.parse_if_match(if_match) != record.version:
        raise ProblemError(412, STALE_RECORD)


async def write_data(session: AsyncSession, record: Record, data: dict[str, Any]) -> None:
    """Store new data and move the record to its next version."""
    record.data = data
    record.version = record.version + 1
    record.updated_at = datetime.now(UTC)
    await session.flush()


async def render_changed(
    session: AsyncSession, actor: User, loaded: Loaded
) -> tuple[Record, RecordPublic]:
    """The record after the change, as the caller may see it."""
    await session.refresh(loaded.record)
    rendered = await service.render(
        session, actor, loaded.context, [loaded.record], service.visible_columns(loaded.fields)
    )
    return loaded.record, rendered[0]
