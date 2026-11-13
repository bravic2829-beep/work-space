from tests.helpers import app_client


async def test_ready_ok_when_database_is_reachable(temp_database_url: str) -> None:
    async with app_client(temp_database_url) as client:
        response = await client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


async def test_ready_503_when_database_is_unreachable() -> None:
    # Nothing listens on port 1, so the connection is refused.
    async with app_client("postgresql+asyncpg://u:p@127.0.0.1:1/db") as client:
        response = await client.get("/api/v1/health/ready")
    assert response.status_code == 503
    # No error details (host, driver messages) may leak to the client.
    assert response.json() == {"status": "unavailable", "database": "error"}


async def test_ready_503_when_database_is_not_configured() -> None:
    async with app_client(None) as client:
        response = await client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "error"}


async def test_liveness_does_not_need_database() -> None:
    async with app_client(None) as client:
        response = await client.get("/api/v1/health")
    assert response.status_code == 200
