"""Writing the history of a task. Called by the code that changes the task, in its transaction,
so the history and the task can never disagree."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.activity.models import ActivityAction, ActivityEntry


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """The cells that differ, as {column id: {"from": old, "to": new}} (None for empty)."""
    keys = set(before) | set(after)
    return {
        key: {"from": before.get(key), "to": after.get(key)}
        for key in sorted(keys)
        if before.get(key) != after.get(key)
    }


async def record_activity(
    session: AsyncSession,
    *,
    record_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: ActivityAction,
    changes: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    session.add(
        ActivityEntry(
            record_id=record_id,
            actor_id=actor_id,
            action=action,
            changes=changes or {},
            note=note,
        )
    )
    await session.flush()
