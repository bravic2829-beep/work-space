import subprocess
import sys

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import create_engine, create_sessionmaker
from app.core.security import verify_password
from app.modules.users.service import (
    InvalidSuperAdminInputError,
    OwnerAlreadyExistsError,
    create_super_admin,
)
from tests.helpers import BACKEND_DIR, asyncpg_dsn, subprocess_env

PASSWORD = "S3cret-pass-for-tests"


async def _create(session: AsyncSession, **overrides: str) -> None:
    values = {
        "employee_code": "ADMIN001",
        "full_name": "System Admin",
        "password": PASSWORD,
        "organization_name": "Acme",
    }
    await create_super_admin(session, **{**values, **overrides})


async def test_creates_organization_and_owner(migrated_database_url: str) -> None:
    engine = create_engine(migrated_database_url)
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            await _create(session)
    finally:
        await engine.dispose()

    conn = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        org = await conn.fetchrow("SELECT name FROM organizations")
        user = await conn.fetchrow("SELECT * FROM users")
        workspaces = await conn.fetch(
            "SELECT w.kind, w.owner_user_id, m.role FROM workspaces w"
            " JOIN workspace_members m ON m.workspace_id = w.id"
        )
    finally:
        await conn.close()

    assert org is not None and org["name"] == "Acme"
    assert user is not None
    # The Super Admin gets a personal workspace like every other employee.
    assert [(w["kind"], w["owner_user_id"], w["role"]) for w in workspaces] == [
        ("personal", user["id"], "admin")
    ]
    assert user is not None
    assert user["employee_code"] == "ADMIN001"
    assert (user["org_role"], user["level"], user["status"]) == ("owner", "admin", "active")
    # The password is stored only as an argon2 hash.
    assert user["password_hash"] != PASSWORD
    assert verify_password(user["password_hash"], PASSWORD) is True


async def test_refuses_a_second_owner(migrated_database_url: str) -> None:
    engine = create_engine(migrated_database_url)
    try:
        sessionmaker = create_sessionmaker(engine)
        async with sessionmaker() as session, session.begin():
            await _create(session)
        with pytest.raises(OwnerAlreadyExistsError):
            async with sessionmaker() as session, session.begin():
                await _create(session, employee_code="ADMIN002")
    finally:
        await engine.dispose()

    conn = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        assert await conn.fetchval("SELECT count(*) FROM users") == 1
    finally:
        await conn.close()


async def test_concurrent_seeds_create_only_one_owner(migrated_database_url: str) -> None:
    import asyncio

    engine = create_engine(migrated_database_url)
    sessionmaker = create_sessionmaker(engine)

    async def attempt(code: str) -> str:
        try:
            async with sessionmaker() as session, session.begin():
                await _create(session, employee_code=code)
        except OwnerAlreadyExistsError:
            return "refused"
        return "created"

    try:
        results = await asyncio.gather(*(attempt(f"ADMIN{i}") for i in range(5)))
    finally:
        await engine.dispose()

    assert sorted(results) == ["created", "refused", "refused", "refused", "refused"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"employee_code": "   "},
        {"full_name": ""},
        {"organization_name": " "},
        {"password": "short"},
    ],
)
async def test_rejects_invalid_input_without_writing(
    migrated_database_url: str, overrides: dict[str, str]
) -> None:
    engine = create_engine(migrated_database_url)
    try:
        with pytest.raises(InvalidSuperAdminInputError):
            async with create_sessionmaker(engine)() as session, session.begin():
                await _create(session, **overrides)
    finally:
        await engine.dispose()

    conn = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        assert await conn.fetchval("SELECT count(*) FROM users") == 0
        assert await conn.fetchval("SELECT count(*) FROM organizations") == 0
    finally:
        await conn.close()


def _run_cli(database_url: str, password: str | None) -> subprocess.CompletedProcess[str]:
    extra = {"SEED_ADMIN_PASSWORD": password} if password is not None else {}
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "app.cli",
            "seed-superadmin",
            "--employee-code",
            "ADMIN001",
            "--full-name",
            "System Admin",
        ],
        cwd=BACKEND_DIR,
        env=subprocess_env(database_url, **extra),
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        check=False,
    )


async def test_cli_creates_the_owner_then_refuses_and_never_prints_the_password(
    migrated_database_url: str,
) -> None:
    first = _run_cli(migrated_database_url, PASSWORD)
    assert first.returncode == 0, first.stderr
    assert "ADMIN001" in first.stdout

    second = _run_cli(migrated_database_url, PASSWORD)
    assert second.returncode == 1
    assert "owner already exists" in second.stderr

    assert PASSWORD not in first.stdout + first.stderr + second.stdout + second.stderr


async def test_cli_refuses_a_short_password(migrated_database_url: str) -> None:
    result = _run_cli(migrated_database_url, "short")
    assert result.returncode == 1
    assert "at least" in result.stderr
