from pydantic import BaseModel, ConfigDict, Field

from app.core.security import MIN_PASSWORD_LENGTH


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_code: str = Field(min_length=1, max_length=50)
    # The upper bound stops absurdly long inputs from making the password hash expensive.
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = False


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=128)
