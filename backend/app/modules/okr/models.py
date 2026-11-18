"""OKR: objectives and key results, in cycles (a quarter, a year).

An Objective says where a person, a team or the company wants to go. Under it, 3 to 5 Key Results
say how progress is measured: a start value, a target value and the value now. The progress of a
Key Result is worked out from those three numbers (see service.progress); the progress of an
Objective is the average of its Key Results. Every week the owner of a Key Result checks in: the
new value, how confident they are, and a note; each check-in is kept.

This module has its own tables and does not change any other module.
"""

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import str_enum


class CycleStatus(enum.StrEnum):
    OPEN = "open"
    CLOSED = "closed"


class OkrLevel(enum.StrEnum):
    """Who the objective is for. Company objectives sit at the top, personal ones at the bottom."""

    COMPANY = "company"
    DEPARTMENT = "department"
    PERSONAL = "personal"


class KrStatus(enum.StrEnum):
    """How the owner of a Key Result feels about reaching it (a judgement, not a calculation)."""

    ON_TRACK = "on_track"
    AT_RISK = "at_risk"
    OFF_TRACK = "off_track"


class OkrCycle(Base):
    __tablename__ = "okr_cycles"
    __table_args__ = (
        CheckConstraint("ends_on >= starts_on", name="ends_after_start"),
        Index("uq_okr_cycles_org_name", "organization_id", text("lower(name)"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(120))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    status: Mapped[CycleStatus] = mapped_column(
        str_enum(CycleStatus, "okr_cycle_status"),
        default=CycleStatus.OPEN,
        server_default="open",
    )
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Objective(Base):
    __tablename__ = "okr_objectives"
    __table_args__ = (
        CheckConstraint("score IS NULL OR (score >= 0 AND score <= 1)", name="score_range"),
        CheckConstraint(
            "(level = 'department') = (department_id IS NOT NULL)", name="department_for_level"
        ),
        CheckConstraint("parent_id <> id", name="no_self_parent"),
        Index("ix_okr_objectives_cycle_id", "cycle_id"),
        Index("ix_okr_objectives_owner_id", "owner_id"),
        Index("ix_okr_objectives_parent_id", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    cycle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("okr_cycles.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    level: Mapped[OkrLevel] = mapped_column(str_enum(OkrLevel, "okr_level"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT")
    )
    # The objective this one supports (alignment). Removed with it: the child becomes a root.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("okr_objectives.id", ondelete="SET NULL")
    )
    # Everybody sees the OKRs of the company (that is the point); a private one is seen only by
    # the people who work on it, their managers and admins.
    is_private: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # The review at the end of the cycle, written by somebody other than the owner.
    score: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    merits: Mapped[str | None] = mapped_column(Text)
    to_improve: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TaskLink(Base):
    __tablename__ = "okr_task_links"
    __table_args__ = (Index("ix_okr_task_links_record_id", "record_id"),)

    key_result_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("okr_key_results.id", ondelete="CASCADE"), primary_key=True
    )
    record_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )


class KeyResult(Base):
    __tablename__ = "okr_key_results"
    __table_args__ = (
        CheckConstraint("target_value <> start_value", name="target_differs_from_start"),
        CheckConstraint("score IS NULL OR (score >= 0 AND score <= 1)", name="score_range"),
        Index("ix_okr_key_results_objective_id", "objective_id"),
        Index("ix_okr_key_results_owner_id", "owner_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    objective_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("okr_objectives.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(300))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    # "%", "$", "customers"... shown after the numbers; free text.
    unit: Mapped[str] = mapped_column(String(20), default="", server_default="")
    start_value: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, server_default="0")
    target_value: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    current_value: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    status: Mapped[KrStatus] = mapped_column(
        str_enum(KrStatus, "okr_kr_status"), default=KrStatus.ON_TRACK, server_default="on_track"
    )
    score: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    merits: Mapped[str | None] = mapped_column(Text)
    to_improve: Mapped[str | None] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CheckIn(Base):
    """One weekly update of a Key Result. Kept for ever: it is the history of the progress."""

    __tablename__ = "okr_check_ins"
    __table_args__ = (Index("ix_okr_check_ins_key_result_created", "key_result_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    key_result_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("okr_key_results.id", ondelete="CASCADE")
    )
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    value: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    status: Mapped[KrStatus] = mapped_column(str_enum(KrStatus, "okr_check_in_status"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
