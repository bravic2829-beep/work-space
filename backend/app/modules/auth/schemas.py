from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_code: str = Field(min_length=1, max_length=50)
    # The upper bound stops absurdly long inputs from making the password hash expensive.
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = False
