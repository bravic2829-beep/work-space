import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.modules.notifications.models import NotificationType


class NotificationActor(BaseModel):
    id: uuid.UUID
    full_name: str


class NotificationPublic(BaseModel):
    id: uuid.UUID
    type: NotificationType
    record_id: uuid.UUID
    table_id: uuid.UUID
    record_name: str | None
    actor: NotificationActor
    read_at: datetime | None
    created_at: datetime


class NotificationUpdate(BaseModel):
    """Only reading is supported: a notification is marked read, never edited."""

    model_config = ConfigDict(extra="forbid")

    read: bool


class UnreadCount(BaseModel):
    unread: int
