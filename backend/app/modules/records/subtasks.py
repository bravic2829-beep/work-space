"""Who may create a subtask without being an editor of the workspace (docs/usecases.md 3.2).

A department head who is assigned a task may split it into subtasks. This is a narrow
exception to "only editors create records": the new record must be a subtask of a task in the
same table that names the caller in its assignee field, and nothing else changes. The caller
does not get a general right to create records.
"""

import uuid
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import FORBIDDEN, ProblemError
from app.modules.fields import repository as fields_repo
from app.modules.fields.models import FieldSemantic
from app.modules.fields.semantics import by_semantic
from app.modules.organizations.models import Department
from app.modules.records.models import Record
from app.modules.users.models import User


async def is_department_head(session: AsyncSession, user: User) -> bool:
    result = await session.execute(
        select(
            exists().where(
                Department.head_user_id == user.id,
                Department.organization_id == user.organization_id,
            )
        )
    )
    return bool(result.scalar_one())


async def require_subtask_right(
    session: AsyncSession, actor: User, table_id: uuid.UUID, incoming: dict[str, Any]
) -> None:
    """403 unless `incoming` makes a subtask of a task assigned to `actor`, and `actor` is a head.

    Every refusal is the same 403, so the answer does not say which task ids exist.
    """
    if not await is_department_head(session, actor):
        raise ProblemError(403, FORBIDDEN)

    fields = await fields_repo.list_fields(session, table_id=table_id)
    parent_field = by_semantic(fields, FieldSemantic.PARENT)
    assignee_field = by_semantic(fields, FieldSemantic.ASSIGNEE)
    if parent_field is None or assignee_field is None:
        raise ProblemError(403, FORBIDDEN)

    value = incoming.get(str(parent_field.id))
    if not isinstance(value, list) or len(value) != 1:
        raise ProblemError(403, FORBIDDEN)
    try:
        parent_id = uuid.UUID(str(value[0]))
    except ValueError:
        raise ProblemError(403, FORBIDDEN) from None

    parent = (
        await session.execute(
            select(Record).where(
                Record.id == parent_id,
                Record.table_id == table_id,
                Record.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if parent is None:
        raise ProblemError(403, FORBIDDEN)
    assigned = {str(item) for item in parent.data.get(str(assignee_field.id), [])}
    if str(actor.id) not in assigned:
        raise ProblemError(403, FORBIDDEN)
