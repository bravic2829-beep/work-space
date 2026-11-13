import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from tests.helpers import asyncpg_dsn


@pytest.fixture
async def conn(migrated_database_url: str) -> AsyncIterator[asyncpg.Connection]:
    connection = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        yield connection
    finally:
        await connection.close()


async def _new_org(conn: asyncpg.Connection) -> uuid.UUID:
    org_id: uuid.UUID = await conn.fetchval(
        "INSERT INTO organizations (name) VALUES ('Acme') RETURNING id"
    )
    return org_id


async def _new_user(
    conn: asyncpg.Connection,
    org_id: uuid.UUID,
    code: str = "E001",
    *,
    level: str = "employee",
    org_role: str = "member",
    manager_id: uuid.UUID | None = None,
    department_id: uuid.UUID | None = None,
) -> uuid.UUID:
    user_id: uuid.UUID = await conn.fetchval(
        "INSERT INTO users (organization_id, employee_code, full_name, password_hash,"
        " org_role, level, manager_id, department_id)"
        " VALUES ($1, $2, 'Name', 'hash', $3, $4, $5, $6) RETURNING id",
        org_id,
        code,
        org_role,
        level,
        manager_id,
        department_id,
    )
    return user_id


async def test_user_defaults_are_set_by_the_database(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    user_id = await _new_user(conn, org_id)
    row = await conn.fetchrow(
        "SELECT status, created_at, updated_at FROM users WHERE id = $1", user_id
    )
    assert row is not None
    assert row["status"] == "active"
    assert row["created_at"] is not None


async def test_employee_code_is_unique_within_an_organization(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    await _new_user(conn, org_id, "E001")
    with pytest.raises(asyncpg.UniqueViolationError):
        await _new_user(conn, org_id, "E001")


async def test_same_employee_code_is_allowed_in_another_organization(
    conn: asyncpg.Connection,
) -> None:
    await _new_user(conn, await _new_org(conn), "E001")
    await _new_user(conn, await _new_org(conn), "E001")


@pytest.mark.parametrize(
    ("column", "bad_value"),
    [("level", "boss"), ("org_role", "superuser"), ("status", "deleted")],
)
async def test_invalid_enum_values_are_rejected(
    conn: asyncpg.Connection, column: str, bad_value: str
) -> None:
    org_id = await _new_org(conn)
    user_id = await _new_user(conn, org_id)
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(f"UPDATE users SET {column} = $1 WHERE id = $2", bad_value, user_id)  # noqa: S608


async def test_user_cannot_be_their_own_manager(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    user_id = await _new_user(conn, org_id)
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute("UPDATE users SET manager_id = id WHERE id = $1", user_id)


async def test_department_cannot_be_its_own_parent(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    dept_id = await conn.fetchval(
        "INSERT INTO departments (organization_id, name, kind) VALUES ($1, 'D', 'department')"
        " RETURNING id",
        org_id,
    )
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute("UPDATE departments SET parent_id = id WHERE id = $1", dept_id)


async def test_department_kind_is_restricted(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO departments (organization_id, name, kind) VALUES ($1, 'D', 'team')", org_id
        )


async def test_user_must_belong_to_an_existing_organization(conn: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await _new_user(conn, uuid.uuid4())


async def test_organization_with_users_cannot_be_deleted(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    await _new_user(conn, org_id)
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conn.execute("DELETE FROM organizations WHERE id = $1", org_id)


async def test_manager_with_reports_cannot_be_deleted(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    boss = await _new_user(conn, org_id, "BOSS", level="department_manager")
    await _new_user(conn, org_id, "E002", manager_id=boss)
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conn.execute("DELETE FROM users WHERE id = $1", boss)


async def test_deleting_a_user_removes_their_sessions(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    user_id = await _new_user(conn, org_id)
    await conn.execute(
        "INSERT INTO auth_sessions (user_id, expires_at) VALUES ($1, now() + interval '1 hour')",
        user_id,
    )
    await conn.execute("DELETE FROM users WHERE id = $1", user_id)
    assert await conn.fetchval("SELECT count(*) FROM auth_sessions") == 0


async def test_session_defaults(conn: asyncpg.Connection) -> None:
    org_id = await _new_org(conn)
    user_id = await _new_user(conn, org_id)
    row = await conn.fetchrow(
        "INSERT INTO auth_sessions (user_id, expires_at) VALUES ($1, now() + interval '1 hour')"
        " RETURNING id, remember_me, revoked_at",
        user_id,
    )
    assert row is not None
    assert row["id"] is not None
    assert row["remember_me"] is False
    assert row["revoked_at"] is None
