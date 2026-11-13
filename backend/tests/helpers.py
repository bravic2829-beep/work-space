import os
import subprocess
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import asyncpg
from alembic.config import Config
from alembic.script import ScriptDirectory
from httpx import ASGITransport, AsyncClient
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.main import create_app

BACKEND_DIR = Path(__file__).resolve().parents[1]


TEST_JWT_SECRET = "test-secret-with-more-than-thirty-two-characters"
ALLOWED_ORIGIN = "http://localhost:3000"


@asynccontextmanager
async def app_client(
    database_url: str | None,
    *,
    raise_app_exceptions: bool = True,
    **settings_overrides: Any,
) -> AsyncIterator[AsyncClient]:
    """HTTP client against the app, with the lifespan (DB engine) started and stopped."""
    values: dict[str, Any] = {
        "app_env": "test",
        "cors_allowed_origins": [ALLOWED_ORIGIN],
        "database_url": database_url,
        "jwt_secret": TEST_JWT_SECRET,
        **settings_overrides,
    }
    settings = Settings(_env_file=None, **values)
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        # False makes an unhandled error come back as a 500 response, as a browser would see it.
        transport = ASGITransport(app=app, raise_app_exceptions=raise_app_exceptions)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


def subprocess_env(database_url: str, **extra: str) -> dict[str, str]:
    # DATABASE_URL from the environment takes priority over the .env file.
    return {**os.environ, "DATABASE_URL": database_url, **extra}


def run_alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    # A subprocess keeps Alembic's own event loop separate from the pytest one.
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=subprocess_env(database_url),
        capture_output=True,
        text=True,
        check=False,
    )


def head_revision() -> str:
    """The newest migration revision in the repository."""
    script = ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini")))
    head = script.get_current_head()
    assert head is not None
    return head


def asyncpg_dsn(database_url: str) -> str:
    return make_url(database_url).set(drivername="postgresql").render_as_string(hide_password=False)


async def current_versions(database_url: str) -> list[str]:
    conn = await asyncpg.connect(asyncpg_dsn(database_url), timeout=5)
    try:
        rows = await conn.fetch("SELECT version_num FROM alembic_version")
        return [row["version_num"] for row in rows]
    finally:
        await conn.close()
