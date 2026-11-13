from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Repository root (.env lives there, next to docker-compose.yml). In containers the file is
# absent and values come from real environment variables instead.
_ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"

MIN_JWT_SECRET_LENGTH = 32


class Settings(BaseSettings):
    """Application settings, read from environment variables (and an optional .env file)."""

    model_config = SettingsConfigDict(env_file=_ROOT_ENV_FILE, extra="ignore")

    app_env: Literal["local", "test", "production"] = "local"
    cors_allowed_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    # e.g. postgresql+asyncpg://user:password@host:port/dbname. No default: never hardcode secrets.
    database_url: str | None = None

    # Authentication (docs/adr/0001). No default secret: it must come from the environment.
    jwt_secret: SecretStr | None = None
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    session_hours: int = 12
    remember_me_days: int = 7
    session_cookie_name: str = "workbase_session"
    cookie_secure: bool = False

    # Brute-force protection on login: lock one employee code for a short time after N failures.
    login_max_failures: int = 5
    login_lock_minutes: int = 5

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("cors_allowed_origins")
    @classmethod
    def _reject_wildcard(cls, value: list[str]) -> list[str]:
        # Credentials (cookies) are used, so a wildcard origin is never acceptable.
        if "*" in value:
            raise ValueError("CORS_ALLOWED_ORIGINS must list exact origins, not '*'")
        return value

    @field_validator("jwt_secret")
    @classmethod
    def _check_secret_length(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and len(value.get_secret_value()) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(f"JWT_SECRET must have at least {MIN_JWT_SECRET_LENGTH} characters")
        return value

    def require_jwt_secret(self) -> str:
        """The signing secret, or an error when it is missing or still the example value."""
        if self.jwt_secret is None:
            raise RuntimeError("JWT_SECRET is not set. Copy .env.example to .env first.")
        secret = self.jwt_secret.get_secret_value()
        if self.app_env != "test" and secret.startswith("change_me"):
            raise RuntimeError("JWT_SECRET still has the example value. Generate a real one.")
        return secret


@lru_cache
def get_settings() -> Settings:
    return Settings()
