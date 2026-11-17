import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class RecordPublic(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    # field id -> value, only for the columns the caller may see. Empty cells are left out,
    # except link fields, which are always a list.
    data: dict[str, Any]
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    version: int


class RecordCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: dict[str, Any] = {}


class RecordUpdate(BaseModel):
    """Only the cells that are sent change. `null` clears a cell."""

    model_config = ConfigDict(extra="forbid")

    data: dict[str, Any]


class ReviewAction(BaseModel):
    """submit: report done (needs review). approve: reviewer says done. reject: back to work.
    pause: put the work on hold. block: report a blocker. resume: pick it up again."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["submit", "approve", "reject", "pause", "block", "resume"]
    # Required to send back (reject) and to report a blocker (block): the why.
    reason: str | None = Field(default=None, max_length=2000)


class TimerAction(BaseModel):
    """start: the person who gave the task begins the clock. stop: the assignee ends it."""

    model_config = ConfigDict(extra="forbid")

    action: Literal["start", "stop"]
    # Which timer column, when the table has more than one. Left out: the table's only timer.
    field_id: uuid.UUID | None = None
