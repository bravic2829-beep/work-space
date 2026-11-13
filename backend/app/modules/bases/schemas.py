import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.modules.fields.schemas import FieldPublic

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class BasePublic(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    created_at: datetime


class BaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class BaseUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class TablePublic(BaseModel):
    id: uuid.UUID
    base_id: uuid.UUID
    name: str
    created_at: datetime


class TableDetail(TablePublic):
    """A table with the columns the caller is allowed to see."""

    fields: list[FieldPublic]
    my_role: str | None


class TableCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    # "blank": one text field called Name. "tasks": the fields a task table needs
    # (assignee, follower, status, due date, parent and subtasks).
    template: Literal["blank", "tasks"] = "blank"


class TableUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
