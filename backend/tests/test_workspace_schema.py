import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest

from tests.helpers import asyncpg_dsn

INSERT_SHARED_WORKSPACE = (
    "INSERT INTO workspaces (organization_id, name, kind) VALUES ($1, 'S', 'shared') RETURNING id"
)


@pytest.fixture
async def conn(migrated_database_url: str) -> AsyncIterator[asyncpg.Connection]:
    connection = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        yield connection
    finally:
        await connection.close()


async def _org_and_user(
    conn: asyncpg.Connection, code: str = "E001"
) -> tuple[uuid.UUID, uuid.UUID]:
    org_id: uuid.UUID = await conn.fetchval(
        "INSERT INTO organizations (name) VALUES ('Acme') RETURNING id"
    )
    user_id: uuid.UUID = await conn.fetchval(
        "INSERT INTO users"
        " (organization_id, employee_code, full_name, password_hash, org_role, level)"
        " VALUES ($1, $2, 'N', 'h', 'member', 'employee') RETURNING id",
        org_id,
        code,
    )
    return org_id, user_id


async def test_personal_workspace_needs_an_owner(conn: asyncpg.Connection) -> None:
    org_id, _ = await _org_and_user(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO workspaces (organization_id, name, kind) VALUES ($1, 'P', 'personal')",
            org_id,
        )


async def test_shared_workspace_cannot_have_an_owner(conn: asyncpg.Connection) -> None:
    org_id, user_id = await _org_and_user(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO workspaces (organization_id, name, kind, owner_user_id)"
            " VALUES ($1, 'S', 'shared', $2)",
            org_id,
            user_id,
        )


async def test_an_employee_has_at_most_one_personal_workspace(conn: asyncpg.Connection) -> None:
    org_id, user_id = await _org_and_user(conn)
    insert = (
        "INSERT INTO workspaces (organization_id, name, kind, owner_user_id)"
        " VALUES ($1, 'P', 'personal', $2)"
    )
    await conn.execute(insert, org_id, user_id)
    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(insert, org_id, user_id)


async def test_workspace_kind_and_member_role_are_restricted(conn: asyncpg.Connection) -> None:
    org_id, user_id = await _org_and_user(conn)
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO workspaces (organization_id, name, kind) VALUES ($1, 'X', 'secret')",
            org_id,
        )
    workspace_id = await conn.fetchval(
        INSERT_SHARED_WORKSPACE,
        org_id,
    )
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'god')",
            workspace_id,
            user_id,
        )


async def test_a_user_joins_a_workspace_only_once(conn: asyncpg.Connection) -> None:
    org_id, user_id = await _org_and_user(conn)
    workspace_id = await conn.fetchval(
        INSERT_SHARED_WORKSPACE,
        org_id,
    )
    insert = "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')"
    await conn.execute(insert, workspace_id, user_id)
    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(insert, workspace_id, user_id)


async def test_deleting_a_workspace_removes_its_members(conn: asyncpg.Connection) -> None:
    org_id, user_id = await _org_and_user(conn)
    workspace_id = await conn.fetchval(
        INSERT_SHARED_WORKSPACE,
        org_id,
    )
    await conn.execute(
        "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'viewer')",
        workspace_id,
        user_id,
    )
    await conn.execute("DELETE FROM workspaces WHERE id = $1", workspace_id)
    assert await conn.fetchval("SELECT count(*) FROM workspace_members") == 0


async def test_a_user_who_owns_a_workspace_cannot_be_deleted(conn: asyncpg.Connection) -> None:
    org_id, user_id = await _org_and_user(conn)
    await conn.execute(
        "INSERT INTO workspaces (organization_id, name, kind, owner_user_id)"
        " VALUES ($1, 'P', 'personal', $2)",
        org_id,
        user_id,
    )
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conn.execute("DELETE FROM users WHERE id = $1", user_id)
