"""Migration 0013: the two timer date columns become one `timer` column, with the data kept."""

import json
import uuid

import asyncpg

from tests.helpers import asyncpg_dsn, run_alembic


async def test_a_pair_of_timer_columns_becomes_one_timer_column(temp_database_url: str) -> None:
    assert run_alembic(temp_database_url, "upgrade", "0012").returncode == 0
    conn = await asyncpg.connect(asyncpg_dsn(temp_database_url), timeout=5)
    try:
        org = await conn.fetchval("INSERT INTO organizations (name) VALUES ('Acme') RETURNING id")
        user = await conn.fetchval(
            "INSERT INTO users (organization_id, employee_code, full_name, password_hash,"
            " org_role, level) VALUES ($1, 'E1', 'N', 'h', 'member', 'employee') RETURNING id",
            org,
        )
        workspace = await conn.fetchval(
            "INSERT INTO workspaces (organization_id, name, kind)"
            " VALUES ($1, 'W', 'shared') RETURNING id",
            org,
        )
        base = await conn.fetchval(
            "INSERT INTO bases (workspace_id, name) VALUES ($1, 'B') RETURNING id", workspace
        )
        table = await conn.fetchval(
            "INSERT INTO tables (base_id, name) VALUES ($1, 'T') RETURNING id", base
        )

        async def field(name: str, semantic: str | None, deleted: bool = False) -> uuid.UUID:
            found: uuid.UUID = await conn.fetchval(
                "INSERT INTO fields (table_id, name, type, semantic, deleted_at)"
                " VALUES ($1, $2, 'date', $3, CASE WHEN $4 THEN now() END) RETURNING id",
                table,
                name,
                semantic,
                deleted,
            )
            return found

        started = await field("Started at", "timer_start")
        finished = await field("Finished at", "timer_stop")
        # A column that was deleted while it still had a role must not stop the migration.
        old_start = await field("Old start", "timer_start", deleted=True)

        async def record(data: dict[str, str]) -> uuid.UUID:
            found: uuid.UUID = await conn.fetchval(
                "INSERT INTO records (table_id, data, created_by) VALUES ($1, $2::jsonb, $3)"
                " RETURNING id",
                table,
                json.dumps(data),
                user,
            )
            return found

        idle = await record({"other": "kept"})
        running = await record({str(started): "2026-11-14T08:00:00Z"})
        done = await record(
            {str(started): "2026-11-14T08:00:00Z", str(finished): "2026-11-14T09:30:05Z"}
        )

        assert run_alembic(temp_database_url, "upgrade", "head").returncode == 0

        async def data_of(record_id: uuid.UUID) -> dict[str, object]:
            raw = await conn.fetchval("SELECT data FROM records WHERE id = $1", record_id)
            parsed: dict[str, object] = json.loads(raw)
            return parsed

        assert await data_of(idle) == {"other": "kept"}
        assert await data_of(running) == {str(started): {"started_at": "2026-11-14T08:00:00Z"}}
        assert await data_of(done) == {
            str(started): {
                "started_at": "2026-11-14T08:00:00Z",
                "finished_at": "2026-11-14T09:30:05Z",
            }
        }

        timer = await conn.fetchrow("SELECT * FROM fields WHERE id = $1", started)
        assert timer is not None
        assert (timer["type"], timer["semantic"], timer["name"]) == ("timer", None, "Timer")
        assert timer["deleted_at"] is None
        stop = await conn.fetchrow("SELECT * FROM fields WHERE id = $1", finished)
        assert stop is not None
        assert stop["deleted_at"] is not None and stop["semantic"] is None
        leftover = await conn.fetchrow("SELECT * FROM fields WHERE id = $1", old_start)
        assert leftover is not None and leftover["semantic"] is None
        assert leftover["type"] == "date"
        # Every record that held a timer value moved to a new version, so a stale page is refused.
        versions = {
            row["id"]: row["version"] for row in await conn.fetch("SELECT id, version FROM records")
        }
        assert versions[idle] == 1
        assert versions[running] == versions[done] == 2
    finally:
        await conn.close()
