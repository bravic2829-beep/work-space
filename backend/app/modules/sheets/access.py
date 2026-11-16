"""Looking up a person's role on the sheets of a record or a table.

Kept apart from the sheet service because the record code needs these answers and the sheet
service needs the record code.
"""

import uuid

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fields.models import Field, FieldSemantic
from app.modules.records.models import Record
from app.modules.sheets.models import SHEET_RANK, Sheet, SheetMember, SheetRole
from app.modules.users.models import User

# Columns a sheet editor cannot change: who the work is for, its state (which moves by Start,
# Stop and the review buttons), the timer, and what the manager says about it.
LOCKED_FOR_EDITORS = frozenset(
    {
        FieldSemantic.ASSIGNEE,
        FieldSemantic.FOLLOWER,
        FieldSemantic.STATUS,
        FieldSemantic.FEEDBACK,
        FieldSemantic.TIMER_START,
        FieldSemantic.TIMER_STOP,
    }
)


def assignee_column(fields: list[Field]) -> Field | None:
    return next(
        (f for f in fields if f.semantic == FieldSemantic.ASSIGNEE and f.deleted_at is None), None
    )


def owners_of(record: Record, fields: list[Field]) -> list[uuid.UUID]:
    """The people named in the assignee column: the owners of the sheets this record is on."""
    column = assignee_column(fields)
    if column is None:
        return []
    return [uuid.UUID(str(item)) for item in record.data.get(str(column.id), [])]


async def role_for_record(
    session: AsyncSession, user: User, record: Record, fields: list[Field]
) -> SheetRole | None:
    """The best role the person has on any live sheet that shows this record."""
    owners = owners_of(record, fields)
    if not owners:
        return None
    rows = (
        (
            await session.execute(
                select(SheetMember.role)
                .join(Sheet, Sheet.id == SheetMember.sheet_id)
                .where(
                    Sheet.table_id == record.table_id,
                    Sheet.archived_at.is_(None),
                    Sheet.owner_id.in_(owners),
                    SheetMember.user_id == user.id,
                )
            )
        )
        .scalars()
        .all()
    )
    return max(rows, key=lambda r: SHEET_RANK[r], default=None)


async def has_sheet_on_table(session: AsyncSession, user: User, table_id: uuid.UUID) -> bool:
    """Is the person a member of any live sheet of the table? That is enough to open the table."""
    result = await session.execute(
        select(
            exists().where(
                SheetMember.user_id == user.id,
                SheetMember.sheet_id == Sheet.id,
                Sheet.table_id == table_id,
                Sheet.archived_at.is_(None),
            )
        )
    )
    return bool(result.scalar_one())
