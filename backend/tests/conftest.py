import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import asyncpg
import pytest
from httpx import AsyncClient
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from tests.helpers import app_client, asyncpg_dsn, run_alembic
from tests.work_world import Work, build_work


def _base_url_text() -> str:
    url = get_settings().database_url
    if not url:
        pytest.fail("DATABASE_URL is not set. Copy .env.example to .env (see README).")
    return url


async def _admin_execute(sql: str) -> None:
    """Run one statement (CREATE or DROP DATABASE) on the configured PostgreSQL server."""
    try:
        conn = await asyncpg.connect(asyncpg_dsn(_base_url_text()), timeout=5)
    except (OSError, asyncpg.PostgresError, TimeoutError) as exc:
        pytest.fail(
            f"PostgreSQL is not reachable ({type(exc).__name__}). Run: docker compose up -d db"
        )
    try:
        await conn.execute(sql)
    finally:
        await conn.close()


def _url_for(database: str) -> str:
    return make_url(_base_url_text()).set(database=database).render_as_string(hide_password=False)


@pytest.fixture(scope="session")
def shared_migrated_database_url() -> Iterator[str]:
    """One database with every migration applied, created once per test session.

    Creating a database per test is slow (seconds each on Docker Desktop). Tests share this
    one and `migrated_database_url` empties its tables after each test. Do not run the suite
    in parallel against it. The main development database is never touched.
    """
    name = f"workbase_test_{uuid.uuid4().hex[:12]}"
    asyncio.run(_admin_execute(f'CREATE DATABASE "{name}"'))
    url = _url_for(name)
    try:
        result = run_alembic(url, "upgrade", "head")
        assert result.returncode == 0, result.stderr
        yield url
    finally:
        asyncio.run(_admin_execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


@pytest.fixture
async def temp_database_url() -> AsyncIterator[str]:
    """An empty, throwaway database (no tables). Requires `docker compose up -d db`."""
    name = f"workbase_test_{uuid.uuid4().hex[:12]}"
    await _admin_execute(f'CREATE DATABASE "{name}"')
    try:
        yield _url_for(name)
    finally:
        await _admin_execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


async def _empty_all_tables(url: str) -> None:
    conn = await asyncpg.connect(asyncpg_dsn(url), timeout=5)
    try:
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables"
            " WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
        )
        if rows:
            names = ", ".join(f'"{row["tablename"]}"' for row in rows)
            await conn.execute(f"TRUNCATE {names} RESTART IDENTITY CASCADE")
    finally:
        await conn.close()


@pytest.fixture
async def migrated_database_url(shared_migrated_database_url: str) -> AsyncIterator[str]:
    """The shared migrated database, empty at the start of each test."""
    yield shared_migrated_database_url
    await _empty_all_tables(shared_migrated_database_url)


@pytest.fixture
def files_dir(tmp_path: Path) -> Path:
    """Where the attached files of a test are kept: a folder of its own, gone after the test."""
    return tmp_path / "attachments"


@pytest.fixture
async def client(migrated_database_url: str, files_dir: Path) -> AsyncIterator[AsyncClient]:
    """An HTTP client against the app and the (empty) shared migrated database."""
    async with app_client(
        migrated_database_url, attachments_dir=str(files_dir), attachment_max_bytes=50_000
    ) as c:
        yield c


@pytest.fixture
async def work(client: AsyncClient, migrated_database_url: str) -> Work:
    """An organization with an admin, a shared workspace and people in every role."""
    return await build_work(client, migrated_database_url)
