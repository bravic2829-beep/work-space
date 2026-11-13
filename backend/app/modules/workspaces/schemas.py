import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.modules.workspaces.models import WorkspaceKind, WorkspaceRole

WorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class WorkspacePublic(BaseModel):
    id: uuid.UUID
    name: str
    kind: WorkspaceKind
    owner_user_id: uuid.UUID | None
    my_role: WorkspaceRole


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: WorkspaceName


class WorkspaceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: WorkspaceName


class MemberPublic(BaseModel):
    user_id: uuid.UUID
    employee_code: str
    full_name: str
    role: WorkspaceRole


class MemberCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    role: WorkspaceRole


class MemberUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: WorkspaceRole
