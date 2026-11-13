"""What a person may do with each column of a table."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fields import repository
from app.modules.fields.models import Field, FieldAccessLevel
from app.modules.permissions.service import TableContext, is_org_admin
from app.modules.users.models import User


async def column_access(
    session: AsyncSession,
    user: User,
    context: TableContext,
    fields: list[Field],
    *,
    is_creator: bool = False,
) -> dict[uuid.UUID, FieldAccessLevel]:
    """The access level of every column for this person.

    Organization admins always edit. Everyone else starts from the default (edit for workspace
    editors and for the creator of the record, read for the rest). A `field_access` row for the
    person overrides that, for example to hide a column from a team member. `hidden` columns are
    left out of every API answer.
    """
    if is_org_admin(user):
        return {field.id: FieldAccessLevel.EDIT for field in fields}
    default = FieldAccessLevel.EDIT if context.can_edit or is_creator else FieldAccessLevel.READ
    overrides = await repository.get_access_overrides(
        session, user_id=user.id, table_id=context.table.id
    )
    return {field.id: overrides.get(field.id, default) for field in fields}
