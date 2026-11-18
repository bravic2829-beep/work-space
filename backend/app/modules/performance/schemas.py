import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.modules.performance.models import Metric

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
Weight = Annotated[int, Field(ge=0, le=100)]
Period = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


class CriterionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Description | None = None
    weight: Weight
    # None: scored by a person.
    metric: Metric | None = None


class CriterionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: Description | None = None
    weight: Weight | None = None
    metric: Metric | None = None
    is_active: bool | None = None
    # Why the criterion changes: kept in its history.
    reason: Reason | None = None

    @field_validator("name", "weight", "is_active")
    @classmethod
    def _not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Cannot be empty.")
        return value


class CriterionPublic(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    weight: int
    metric: Metric | None
    is_active: bool
    position: int


class MetricInfo(BaseModel):
    id: Metric
    label: str
    description: str
    measurable: bool


class Criteria(BaseModel):
    criteria: list[CriterionPublic]
    # The active weights added up (a score is divided by it, so it need not be 100).
    total_weight: int
    can_manage: bool
    metrics: list[MetricInfo]


class ChangePublic(BaseModel):
    id: uuid.UUID
    actor_name: str
    changes: dict[str, Any]
    reason: str | None
    created_at: datetime


class CriterionScore(BaseModel):
    criterion_id: uuid.UUID
    # 0 to 100; None: nothing to judge (never counted as a zero).
    score: float | None
    source: str  # "auto", "manual" or "none"
    detail: str
    reason: str | None = None


class PersonScore(BaseModel):
    user_id: uuid.UUID
    full_name: str
    employee_code: str
    scores: list[CriterionScore]
    # The weighted score over the criteria that have a score, 0 to 100; None when none has.
    total: float | None
    # The share of the active weight that had a score, 0 to 1.
    coverage: float
    can_score: bool


class Scores(BaseModel):
    period: str
    criteria: list[CriterionPublic]
    people: list[PersonScore]


class ScoreSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criterion_id: uuid.UUID
    user_id: uuid.UUID
    period: Period
    score: Annotated[int, Field(ge=0, le=100)]
    reason: Reason
