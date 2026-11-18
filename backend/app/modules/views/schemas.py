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


class ViewTotal(BaseModel):
    """A total shown on the header of every group: the sum, average, smallest or largest value of
    a number column."""

    model_config = ConfigDict(extra="forbid")

    field: uuid.UUID
    fn: Literal["sum", "avg", "min", "max"]


class ViewConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filter: list[Condition] = Field(default_factory=list, max_length=20)
    sort: list[SortColumn] = Field(default_factory=list, max_length=3)
    hidden_fields: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    # The rows are folded into groups of this column's values, with `totals` on each group.
    group_by: uuid.UUID | None = None
    # For a date column: group by day, week or month (month when left out).
    group_bucket: Literal["day", "week", "month"] | None = None
    totals: list[ViewTotal] = Field(default_factory=list, max_length=10)


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
