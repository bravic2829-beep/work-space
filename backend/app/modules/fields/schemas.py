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


class FieldAccessSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access: FieldAccessLevel


class FieldAccessPublic(BaseModel):
    field_id: uuid.UUID
    user_id: uuid.UUID
    access: FieldAccessLevel
