import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


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
