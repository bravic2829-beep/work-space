import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

ViewName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Condition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: uuid.UUID
    op: Annotated[str, StringConstraints(max_length=20)]
    value: Any = None


class SortColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: uuid.UUID
    direction: Literal["asc", "desc"] = "asc"


class ViewConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filter: list[Condition] = Field(default_factory=list, max_length=20)
    sort: list[SortColumn] = Field(default_factory=list, max_length=3)
    hidden_fields: list[uuid.UUID] = Field(default_factory=list, max_length=200)


class ViewPublic(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    name: str
    config: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ViewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ViewName
    config: ViewConfig = Field(default_factory=ViewConfig)


class ViewUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ViewName | None = None
    config: ViewConfig | None = None
