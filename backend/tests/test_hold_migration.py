"""Migration 0015: every status column gets a Paused and a Blocked option; going back is safe."""

import json
import uuid
from typing import Any

import asyncpg

from tests.helpers import asyncpg_dsn, run_alembic

FOUR = [
    {"id": "aaa1", "name": "To do", "kind": "todo"},
    {"id": "aaa2", "name": "In progress", "kind": "in_progress"},
    {"id": "aaa3", "name": "Pending review", "kind": "review"},
    {"id": "aaa4", "name": "Done", "kind": "done"},
]


async def test_status_columns_get_the_two_new_options_and_lose_them_again(
    temp_database_url: str,
) -> None:
    assert run_alembic(temp_database_url, "upgrade", "0014").returncode == 0
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

        async def status_field(
            name: str, options: list[dict[str, str]], deleted: bool = False
        ) -> uuid.UUID:
            found: uuid.UUID = await conn.fetchval(
                "INSERT INTO fields (table_id, name, type, config, deleted_at)"
                " VALUES ($1, $2, 'status', $3::jsonb, CASE WHEN $4 THEN now() END) RETURNING id",
                table,
                name,
                json.dumps({"options": options}),
                deleted,
            )
            return found

        plain = await status_field("Status", FOUR)
        # A column that already has an option named "Paused" (of another kind) keeps it and gets
        # a differently named one: option names are unique in a column.
        taken = await status_field(
            "Stage", [*FOUR, {"id": "bbb1", "name": "Paused", "kind": "todo"}]
        )
        # A column that was deleted is left alone.
        gone = await status_field("Old", FOUR, deleted=True)

        async def options_of(field: uuid.UUID) -> list[dict[str, Any]]:
            raw = await conn.fetchval("SELECT config FROM fields WHERE id = $1", field)
            options: list[dict[str, Any]] = json.loads(raw)["options"]
            return options

        assert run_alembic(temp_database_url, "upgrade", "head").returncode == 0

        added = await options_of(plain)
        assert [o["kind"] for o in added] == [
            "todo",
            "in_progress",
            "review",
            "done",
            "paused",
            "blocked",
        ]
        assert [o["name"] for o in added[4:]] == ["Paused", "Blocked"]
        assert [o["id"] for o in added[:4]] == ["aaa1", "aaa2", "aaa3", "aaa4"]  # ids kept
        assert len({o["id"] for o in added}) == 6

        renamed = await options_of(taken)
        names = [o["name"] for o in renamed]
        assert len(set(names)) == len(names)
        assert {o["kind"] for o in renamed} >= {"paused", "blocked"}
        assert "Paused (on hold)" in names

        assert [o["kind"] for o in await options_of(gone)] == [
            "todo",
            "in_progress",
            "review",
            "done",
        ]

        # The new notification type and history actions are accepted.
        actor = user
        task = await conn.fetchval(
            "INSERT INTO records (table_id, data, created_by) VALUES ($1, $2::jsonb, $3)"
            " RETURNING id",
            table,
            json.dumps({str(plain): added[5]["id"]}),
            user,
        )
        await conn.execute(
            "INSERT INTO notifications (user_id, type, actor_user_id, record_id)"
            " VALUES ($1, 'task_blocked', $1, $2)",
            actor,
            task,
        )
        await conn.execute(
            "INSERT INTO activity_log (record_id, actor_id, action) VALUES ($1, $2, 'blocked')",
            task,
            actor,
        )

        # Going back: the task on the Blocked option returns to "In progress", the options and
        # the rows that need the new values go away.
        assert run_alembic(temp_database_url, "downgrade", "0014").returncode == 0
        assert [o["kind"] for o in await options_of(plain)] == [
            "todo",
            "in_progress",
            "review",
            "done",
        ]
        data = json.loads(await conn.fetchval("SELECT data FROM records WHERE id = $1", task))
        assert data[str(plain)] == "aaa2"
        assert await conn.fetchval("SELECT count(*) FROM notifications") == 0
        assert await conn.fetchval("SELECT count(*) FROM activity_log") == 0
    finally:
        await conn.close()
