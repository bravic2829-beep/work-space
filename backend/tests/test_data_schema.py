"""Database rules of bases, tables, fields and records (they hold if the application is wrong)."""

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


class Ids:
    org: uuid.UUID
    user: uuid.UUID
    workspace: uuid.UUID
    base: uuid.UUID
    table: uuid.UUID


@pytest.fixture
async def ids(conn: asyncpg.Connection) -> Ids:
    found = Ids()
    found.org = await conn.fetchval("INSERT INTO organizations (name) VALUES ('Acme') RETURNING id")
    found.user = await conn.fetchval(
        "INSERT INTO users"
        " (organization_id, employee_code, full_name, password_hash, org_role, level)"
        " VALUES ($1, 'E1', 'N', 'h', 'member', 'employee') RETURNING id",
        found.org,
    )
    found.workspace = await conn.fetchval(
        "INSERT INTO workspaces (organization_id, name, kind)"
        " VALUES ($1, 'W', 'shared') RETURNING id",
        found.org,
    )
    found.base = await conn.fetchval(
        "INSERT INTO bases (workspace_id, name) VALUES ($1, 'B') RETURNING id", found.workspace
    )
    found.table = await conn.fetchval(
        "INSERT INTO tables (base_id, name) VALUES ($1, 'T') RETURNING id", found.base
    )
    return found


async def _field(conn: asyncpg.Connection, ids: Ids, name: str, type_: str = "text") -> uuid.UUID:
    field_id: uuid.UUID = await conn.fetchval(
        "INSERT INTO fields (table_id, name, type) VALUES ($1, $2, $3) RETURNING id",
        ids.table,
        name,
        type_,
    )
    return field_id


async def _record(conn: asyncpg.Connection, ids: Ids) -> uuid.UUID:
    record_id: uuid.UUID = await conn.fetchval(
        "INSERT INTO records (table_id, created_by) VALUES ($1, $2) RETURNING id",
        ids.table,
        ids.user,
    )
    return record_id


async def test_base_names_are_unique_in_a_workspace_ignoring_case(
    conn: asyncpg.Connection, ids: Ids
) -> None:
    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute("INSERT INTO bases (workspace_id, name) VALUES ($1, 'b')", ids.workspace)


async def test_a_deleted_base_frees_its_name(conn: asyncpg.Connection, ids: Ids) -> None:
    await conn.execute("UPDATE bases SET deleted_at = now() WHERE id = $1", ids.base)
    await conn.execute("INSERT INTO bases (workspace_id, name) VALUES ($1, 'B')", ids.workspace)


async def test_table_and_field_names_are_unique_ignoring_case(
    conn: asyncpg.Connection, ids: Ids
) -> None:
    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute("INSERT INTO tables (base_id, name) VALUES ($1, 't')", ids.base)
    await _field(conn, ids, "Budget")
    with pytest.raises(asyncpg.UniqueViolationError):
        await _field(conn, ids, "BUDGET")


async def test_only_one_live_field_per_role(conn: asyncpg.Connection, ids: Ids) -> None:
    async def with_role(name: str) -> None:
        await conn.execute(
            "INSERT INTO fields (table_id, name, type, semantic)"
            " VALUES ($1, $2, 'user', 'assignee')",
            ids.table,
            name,
        )

    await with_role("A")
    with pytest.raises(asyncpg.UniqueViolationError):
        await with_role("B")
    await conn.execute("UPDATE fields SET deleted_at = now() WHERE name = 'A'")
    await with_role("B")  # the first one is deleted, so the role is free


async def test_field_type_and_role_must_be_known_values(conn: asyncpg.Connection, ids: Ids) -> None:
    with pytest.raises(asyncpg.CheckViolationError):
        await _field(conn, ids, "X", "formula")
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO fields (table_id, name, type, semantic) VALUES ($1, 'Y', 'user', 'boss')",
            ids.table,
        )


async def test_things_that_hold_data_cannot_be_hard_deleted(
    conn: asyncpg.Connection, ids: Ids
) -> None:
    await _record(conn, ids)
    for sql, arg in (
        ("DELETE FROM tables WHERE id = $1", ids.table),
        ("DELETE FROM bases WHERE id = $1", ids.base),
        ("DELETE FROM users WHERE id = $1", ids.user),
    ):
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await conn.execute(sql, arg)


async def test_record_defaults(conn: asyncpg.Connection, ids: Ids) -> None:
    record_id = await _record(conn, ids)
    row = await conn.fetchrow(
        "SELECT data::text, version, deleted_at FROM records WHERE id = $1", record_id
    )
    assert row is not None
    assert row["data"] == "{}"
    assert row["version"] == 1
    assert row["deleted_at"] is None


async def test_record_viewers_follow_their_record_and_user(
    conn: asyncpg.Connection, ids: Ids
) -> None:
    record_id = await _record(conn, ids)
    await conn.execute(
        "INSERT INTO record_viewers (record_id, user_id, source_key, reason)"
        " VALUES ($1, $2, 'creator', 'creator')",
        record_id,
        ids.user,
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(
            "INSERT INTO record_viewers (record_id, user_id, source_key, reason)"
            " VALUES ($1, $2, 'creator', 'creator')",
            record_id,
            ids.user,
        )
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO record_viewers (record_id, user_id, source_key, reason)"
            " VALUES ($1, $2, 'x', 'because')",
            record_id,
            ids.user,
        )
    await conn.execute("DELETE FROM records WHERE id = $1", record_id)
    assert await conn.fetchval("SELECT count(*) FROM record_viewers") == 0


async def test_links_follow_their_records(conn: asyncpg.Connection, ids: Ids) -> None:
    a, b = await _record(conn, ids), await _record(conn, ids)
    field = await _field(conn, ids, "Link", "link_record")
    await conn.execute(
        "INSERT INTO record_links (field_id, source_record_id, target_record_id)"
        " VALUES ($1, $2, $3)",
        field,
        a,
        b,
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(
            "INSERT INTO record_links (field_id, source_record_id, target_record_id)"
            " VALUES ($1, $2, $3)",
            field,
            a,
            b,
        )
    await conn.execute("DELETE FROM records WHERE id = $1", b)
    assert await conn.fetchval("SELECT count(*) FROM record_links") == 0


async def test_column_access_levels_are_checked(conn: asyncpg.Connection, ids: Ids) -> None:
    field = await _field(conn, ids, "Salary")
    await conn.execute(
        "INSERT INTO field_access (field_id, user_id, access) VALUES ($1, $2, 'hidden')",
        field,
        ids.user,
    )
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "INSERT INTO field_access (field_id, user_id, access) VALUES ($1, $2, 'root')",
            field,
            uuid.uuid4(),
        )
