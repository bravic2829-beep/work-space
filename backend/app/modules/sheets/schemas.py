import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.modules.sheets.models import SheetRole

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class SheetOwner(BaseModel):
    id: uuid.UUID
    full_name: str
    employee_code: str


class SheetPublic(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    table_name: str
    owner: SheetOwner
    name: str
    # What the caller may do here. Organization admins and workspace admins are managers.
    my_role: SheetRole
    # Admins may also rename, archive and delete the sheet.
    is_admin: bool
    # Whether the caller sees every task of the table (a workspace member), not only this sheet.
    can_see_all: bool
    member_count: int


class MemberIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    role: SheetRole


class SheetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    owner_id: uuid.UUID
    # Defaults to the name of the owner.
    name: Name | None = None
    members: list[MemberIn] = Field(default_factory=list, max_length=50)


class SheetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name


class MemberRoleChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: SheetRole


class MemberPublic(BaseModel):
    user_id: uuid.UUID
    full_name: str
    employee_code: str
    role: SheetRole
    is_owner: bool
