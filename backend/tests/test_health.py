import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app

ALLOWED_ORIGIN = "http://localhost:3000"


def make_client(origins: list[str] | None = None) -> AsyncClient:
    settings = Settings(
        _env_file=None,
        app_env="test",
        cors_allowed_origins=origins or [ALLOWED_ORIGIN],
    )
    return AsyncClient(transport=ASGITransport(app=create_app(settings)), base_url="http://test")


async def test_health_returns_ok() -> None:
    async with make_client() as client:
        response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_cors_allows_configured_origin() -> None:
    async with make_client() as client:
        response = await client.get("/api/v1/health", headers={"Origin": ALLOWED_ORIGIN})
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"


async def test_cors_rejects_unknown_origin() -> None:
    async with make_client() as client:
        response = await client.get("/api/v1/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_wildcard_cors_origin_is_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_allowed_origins=["*"])


def test_cors_origins_parsed_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://a.test, http://b.test")
    settings = Settings(_env_file=None)
    assert settings.cors_allowed_origins == ["http://a.test", "http://b.test"]
