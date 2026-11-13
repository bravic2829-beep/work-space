import uuid
from datetime import datetime

from pydantic import BaseModel


class TaskStatus(BaseModel):
    name: str
    kind: str


class MyTask(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    table_name: str
    name: str | None
    due_date: str | None
    status: TaskStatus | None
    created_at: datetime
