"""What a person may do with each column of a table."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fields import repository
from app.modules.fields.models import Field, FieldAccessLevel, FieldType
from app.modules.permissions.service import TableContext, is_org_admin
from app.modules.sheets.access import LOCKED_FOR_EDITORS
from app.modules.sheets.models import SheetRole
from app.modules.users.models import User


def _sheet_default(role: SheetRole, field: Field) -> FieldAccessLevel:
    """A member of the sheet of a record: managers edit every column, editors all but a few."""
    if role == SheetRole.MANAGER:
        return FieldAccessLevel.EDIT
    if (
        role == SheetRole.EDITOR
        and field.semantic not in LOCKED_FOR_EDITORS
        and field.type != FieldType.TIMER
    ):
        return FieldAccessLevel.EDIT
    return FieldAccessLevel.READ


async def column_access(
    session: AsyncSession,
    user: User,
    context: TableContext,
    fields: list[Field],
    *,
    is_creator: bool = False,
    sheet_role: SheetRole | None = None,
) -> dict[uuid.UUID, FieldAccessLevel]:
    """The access level of every column for this person.

    Organization admins always edit. Everyone else starts from the default: edit for workspace
    editors; for a record on a sheet they belong to, what their role on that sheet allows;
    otherwise edit for the creator of the record and read for the rest. A `field_access` row for
    the person can only narrow that (edit -> read -> hidden), for example to hide a column from a
    team member; it never gives more than the default. `hidden` columns are left out of every API
    answer.
    """
    if is_org_admin(user):
        return {field.id: FieldAccessLevel.EDIT for field in fields}
    overrides = await repository.get_access_overrides(
        session, user_id=user.id, table_id=context.table.id
    )
    result: dict[uuid.UUID, FieldAccessLevel] = {}
    for field in fields:
        if context.can_edit:
            default = FieldAccessLevel.EDIT
        elif sheet_role is not None:
            default = _sheet_default(sheet_role, field)
        else:
            default = FieldAccessLevel.EDIT if is_creator else FieldAccessLevel.READ
        override = overrides.get(field.id)
        # A column rule only narrows what the person may already do: a viewer given "edit" on a
        # column still only reads it.
        result[field.id] = (
            default if override is None or _RANK[override] > _RANK[default] else override
        )
    return result


_RANK = {FieldAccessLevel.HIDDEN: 0, FieldAccessLevel.READ: 1, FieldAccessLevel.EDIT: 2}
