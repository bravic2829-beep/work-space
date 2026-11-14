import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.modules.organizations.models import DepartmentKind

DepartmentName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class DepartmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    kind: DepartmentKind
    parent_id: uuid.UUID | None
    head_user_id: uuid.UUID | None


class DepartmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: DepartmentName
    kind: DepartmentKind
    parent_id: uuid.UUID | None = None
    head_user_id: uuid.UUID | None = None


class DepartmentUpdate(BaseModel):
    """Partial update. The kind never changes: delete and create again instead."""

    model_config = ConfigDict(extra="forbid")

    name: DepartmentName | None = None
    parent_id: uuid.UUID | None = None
    head_user_id: uuid.UUID | None = None
