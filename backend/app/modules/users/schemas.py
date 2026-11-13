import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.core.security import MIN_PASSWORD_LENGTH
from app.modules.users.models import OrgRole, UserLevel, UserStatus

EmployeeCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class UserPublic(BaseModel):
    """What the API returns about a user. Never includes the password hash."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_code: str
    full_name: str
    org_role: OrgRole
    level: UserLevel
    status: UserStatus
    department_id: uuid.UUID | None
    manager_id: uuid.UUID | None


class DirectoryEntry(BaseModel):
    """What any signed-in employee may know about a colleague: enough to pick them in a field."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_code: str
    full_name: str


def _forbid_owner(value: OrgRole | None) -> OrgRole | None:
    # The owner is created only by the seed command, never through the API.
    if value == OrgRole.OWNER:
        raise ValueError("The owner role cannot be assigned through the API")
    return value


class UserCreate(BaseModel):
    # Unknown fields are refused, so a client cannot try to slip in id, password_hash, etc.
    model_config = ConfigDict(extra="forbid")

    employee_code: EmployeeCode
    full_name: FullName
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)
    level: UserLevel = UserLevel.EMPLOYEE
    org_role: OrgRole = OrgRole.MEMBER
    department_id: uuid.UUID | None = None
    manager_id: uuid.UUID | None = None

    _check_role = field_validator("org_role")(_forbid_owner)


class UserUpdate(BaseModel):
    """Partial update: only the fields that are sent are changed (null clears an optional one)."""

    model_config = ConfigDict(extra="forbid")

    full_name: FullName | None = None
    level: UserLevel | None = None
    org_role: OrgRole | None = None
    status: UserStatus | None = None
    department_id: uuid.UUID | None = None
    manager_id: uuid.UUID | None = None

    _check_role = field_validator("org_role")(_forbid_owner)

    @field_validator("full_name", "level", "org_role", "status")
    @classmethod
    def _not_null(cls, value: object) -> object:
        # These fields cannot be cleared: omit them instead of sending null.
        if value is None:
            raise ValueError("This field cannot be null")
        return value
