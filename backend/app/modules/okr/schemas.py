import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.modules.okr.models import CycleStatus, KrStatus, OkrLevel

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Unit = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]
Long = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
# Numbers are shown as plain numbers; the database keeps four decimals.
Number = Annotated[float, Field(ge=-1e12, le=1e12, allow_inf_nan=False)]
Score = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class UserRef(BaseModel):
    id: uuid.UUID
    full_name: str
    employee_code: str


class DepartmentRef(BaseModel):
    id: uuid.UUID
    name: str


# --- cycles --------------------------------------------------------------------------------------


class CycleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    starts_on: date
    ends_on: date


class CycleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    status: CycleStatus | None = None

    @field_validator("name", "starts_on", "ends_on", "status")
    @classmethod
    def _not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Cannot be empty.")
        return value


class CyclePublic(BaseModel):
    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    status: CycleStatus
    created_at: datetime


# --- key results ---------------------------------------------------------------------------------


class KeyResultCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    # Left out: the owner of the objective.
    owner_id: uuid.UUID | None = None
    unit: Unit = ""
    start_value: Number = 0
    target_value: Number
    position: int | None = Field(default=None, ge=0, le=10_000)


class KeyResultUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    owner_id: uuid.UUID | None = None
    unit: Unit | None = None
    start_value: Number | None = None
    target_value: Number | None = None
    position: int | None = Field(default=None, ge=0, le=10_000)

    @field_validator("title", "owner_id", "unit", "start_value", "target_value", "position")
    @classmethod
    def _not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Cannot be empty.")
        return value


class CheckInCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: Number
    # Left out: the status stays what it was.
    status: KrStatus | None = None
    note: Long | None = None


class CheckInPublic(BaseModel):
    id: uuid.UUID
    key_result_id: uuid.UUID
    author: UserRef
    value: float
    status: KrStatus
    note: str | None
    created_at: datetime


class ReviewUpdate(BaseModel):
    """The review of an objective or a key result: only the fields that are sent change, and
    null clears one."""

    model_config = ConfigDict(extra="forbid")

    score: Score | None = None
    merits: Long | None = None
    to_improve: Long | None = None


class KeyResultPublic(BaseModel):
    id: uuid.UUID
    objective_id: uuid.UUID
    title: str
    owner: UserRef
    unit: str
    start_value: float
    target_value: float
    current_value: float
    # 0 to 1, worked out from the three values above.
    progress: float
    status: KrStatus
    score: float | None
    merits: str | None
    to_improve: str | None
    position: int
    updated_at: datetime
    last_check_in_at: datetime | None
    # What the person who asks may do with this key result.
    can_check_in: bool


# --- objectives ----------------------------------------------------------------------------------


class ObjectiveCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cycle_id: uuid.UUID
    title: Title
    description: Long | None = None
    # Left out: the person who creates it.
    owner_id: uuid.UUID | None = None
    level: OkrLevel
    department_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    is_private: bool = False


class ObjectiveUpdate(BaseModel):
    """Only the fields that are sent change; `description` and `parent_id` can be sent as null."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    description: Long | None = None
    owner_id: uuid.UUID | None = None
    level: OkrLevel | None = None
    department_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    is_private: bool | None = None
    position: int | None = Field(default=None, ge=0, le=10_000)


class ObjectivePublic(BaseModel):
    id: uuid.UUID
    cycle_id: uuid.UUID
    title: str
    description: str | None
    owner: UserRef
    level: OkrLevel
    department: DepartmentRef | None
    # None when it supports nothing, or supports an objective the reader may not see.
    parent_id: uuid.UUID | None
    is_private: bool
    # The average of its key results, 0 to 1; None while it has none.
    progress: float | None
    score: float | None
    merits: str | None
    to_improve: str | None
    position: int
    can_edit: bool
    can_review: bool
    key_results: list[KeyResultPublic]


class OverviewSummary(BaseModel):
    objectives: int
    key_results: int
    # The average progress of the objectives that have key results; None if there are none.
    progress: float | None
    on_track: int
    at_risk: int
    off_track: int
    # Objectives that have a score.
    reviewed: int


class Overview(BaseModel):
    cycle: CyclePublic
    objectives: list[ObjectivePublic]
    summary: OverviewSummary


class OkrDepartment(BaseModel):
    """A department as the OKR pages need it: its name, and whether the caller may make
    objectives for it (an admin, or its head)."""

    id: uuid.UUID
    name: str
    can_create: bool
