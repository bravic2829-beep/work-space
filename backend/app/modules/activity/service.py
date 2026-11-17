"""Reading the history of a task, with only what the reader may see.

The reader must be able to open the task. Changes to a column hidden from them are left out, and
an "updated" entry that only touched hidden columns is not shown at all, so the history never
tells more than the task itself.
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.activity.models import ActivityAction, ActivityEntry
from app.modules.fields.models import FieldAccessLevel
from app.modules.records import service as records
from app.modules.users.models import User

MAX_ENTRIES = 200


class ActivityActor(BaseModel):
    id: uuid.UUID
    full_name: str


class ActivityChange(BaseModel):
    field_id: uuid.UUID
    field_name: str
    before: Any
    after: Any


class ActivityPublic(BaseModel):
    id: uuid.UUID
    action: ActivityAction
    actor: ActivityActor
    created_at: datetime
    changes: list[ActivityChange]
    note: str | None


async def list_for_record(
    session: AsyncSession, actor: User, record_id: uuid.UUID
) -> list[ActivityPublic]:
    """The newest first, at most MAX_ENTRIES."""
    record, context = await records.load_record(session, actor, record_id)
    fields = await records.fields_with_access(
        session, actor, context, is_creator=record.created_by == actor.id, record=record
    )
    visible = {str(f.id): f for f, level in fields if level != FieldAccessLevel.HIDDEN}
    rows = (
        await session.execute(
            select(ActivityEntry, User)
            .join(User, User.id == ActivityEntry.actor_id)
            .where(ActivityEntry.record_id == record.id)
            .order_by(ActivityEntry.created_at.desc(), ActivityEntry.id.desc())
            .limit(MAX_ENTRIES)
        )
    ).all()

    result: list[ActivityPublic] = []
    for entry, user in rows:
        changes = [
            ActivityChange(
                field_id=visible[key].id,
                field_name=visible[key].name,
                before=change.get("from"),
                after=change.get("to"),
            )
            for key, change in entry.changes.items()
            if key in visible
        ]
        if entry.action == ActivityAction.UPDATED and not changes:
            continue  # only hidden columns changed: say nothing
        result.append(
            ActivityPublic(
                id=entry.id,
                action=entry.action,
                actor=ActivityActor(id=user.id, full_name=user.full_name),
                created_at=entry.created_at,
                changes=changes,
                note=entry.note,
            )
        )
    return result
