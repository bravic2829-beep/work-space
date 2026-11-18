"""Performance criteria: what a person is judged on, and how much each part counts.

A criterion has a name, a weight and a source: one of the measures worked out from the tasks (a
`metric`) or, when there is none, a score that a person writes down (manual). Every change of a
criterion is kept (weights have a history). A manual score is one number from 0 to 100 for one
person, one criterion and one month, with the reason for it.

This module has its own tables and does not change any other module.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class Metric(enum.StrEnum):
    """A measure worked out from the tasks of a person over a month."""

    COMPLETION_RATE = "completion_rate"
    ON_TIME_RATE = "on_time_rate"
    OVERDUE_RATE = "overdue_rate"
    REWORK_RATE = "rework_rate"
    BLOCKED_TASKS = "blocked_tasks"
    UPDATE_COMPLIANCE = "update_compliance"


class Criterion(Base):
    __tablename__ = "perf_criteria"
    __table_args__ = (
        CheckConstraint("weight >= 0 AND weight <= 100", name="weight_range"),
        Index("uq_perf_criteria_org_name", "organization_id", text("lower(name)"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    weight: Mapped[int] = mapped_column(Integer)
    # None: the score is written by a person.
    metric: Mapped[Metric | None] = mapped_column(str_enum(Metric, "perf_metric"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CriterionChange(Base):
    """One change of a criterion: who, when, what changed (as {"weight": {"from": 20, "to": 25}})
    and why."""

    __tablename__ = "perf_criterion_changes"
    __table_args__ = (Index("ix_perf_criterion_changes_criterion_id", "criterion_id"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    criterion_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("perf_criteria.id", ondelete="CASCADE")
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    changes: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ManualScore(Base):
    __tablename__ = "perf_manual_scores"
    __table_args__ = (
        CheckConstraint("score >= 0 AND score <= 100", name="score_range"),
        Index(
            "uq_perf_manual_scores_criterion_user_period",
            "criterion_id",
            "user_id",
            "period",
            unique=True,
        ),
        Index("ix_perf_manual_scores_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    criterion_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("perf_criteria.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # A month, "2026-11".
    period: Mapped[str] = mapped_column(String(7))
    score: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    scored_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
