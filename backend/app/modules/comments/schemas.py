import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

CommentBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]


class CommentAuthor(BaseModel):
    id: uuid.UUID
    full_name: str


class CommentPublic(BaseModel):
    id: uuid.UUID
    record_id: uuid.UUID
    author: CommentAuthor
    body: str
    created_at: datetime


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: CommentBody
