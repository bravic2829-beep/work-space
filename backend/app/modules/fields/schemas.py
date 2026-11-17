import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.modules.fields.models import FieldAccessLevel, FieldSemantic, FieldType

FieldName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class FieldPublic(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    name: str
    type: FieldType
    config: dict[str, Any]
    semantic: FieldSemantic | None
    grants_view: bool
    is_required: bool
    position: int
    # What the caller may do with this column: read or edit (hidden columns are not returned).
    access: FieldAccessLevel
    created_at: datetime


class FieldCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FieldName
    type: FieldType
    config: dict[str, Any] = {}
    semantic: FieldSemantic | None = None
    # Only for user fields, and only chosen when the field is made (ADR 0003).
    grants_view: bool | None = None
    is_required: bool = False
    # For link_record fields: the name of the field made on the other table.
    inverse_name: FieldName | None = None


class FieldUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: FieldName | None = None
    type: FieldType | None = None
    config: dict[str, Any] | None = None
    is_required: bool | None = None
    position: int | None = None
    # The role of the column (assignee, follower, status, due_date). null takes the role away.
    semantic: FieldSemantic | None = None


class FieldAccessSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access: FieldAccessLevel


class FieldAccessPublic(BaseModel):
    field_id: uuid.UUID
    user_id: uuid.UUID
    access: FieldAccessLevel


class ColumnRule(BaseModel):
    field_id: uuid.UUID
    access: FieldAccessLevel


class PersonAccess(BaseModel):
    """What one person is restricted to on the columns of a table (columns not listed: default)."""

    user_id: uuid.UUID
    rules: list[ColumnRule]


class PersonAccessSet(BaseModel):
    """The new rules of one person on a table: column id -> hidden/read/edit, or null to go back
    to the default. Columns that are not named are left as they are."""

    model_config = ConfigDict(extra="forbid")

    fields: dict[uuid.UUID, FieldAccessLevel | None]
