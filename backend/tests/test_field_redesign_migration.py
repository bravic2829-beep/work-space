"""Migration 0016: one select type, url inside text, no date `fill`, option colors, with the
data kept, and the way back."""

import json
import uuid
from typing import Any

import asyncpg

from tests.helpers import asyncpg_dsn, run_alembic


async def _seed(conn: asyncpg.Connection) -> dict[str, Any]:
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

    async def field(
        name: str,
        kind: str,
        config: dict[str, Any] | None = None,
        *,
        semantic: str | None = None,
        required: bool = False,
    ) -> uuid.UUID:
        found: uuid.UUID = await conn.fetchval(
            "INSERT INTO fields (table_id, name, type, config, semantic, is_required)"
            " VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id",
            table,
            name,
            kind,
            json.dumps(config or {}),
            semantic,
            required,
        )
        return found

    one = await field(
        "One",
        "single_select",
        {"options": [{"id": "a", "name": "A"}, {"id": "b", "name": "B", "color": "#123456"}]},
    )
    many = await field(
        "Many", "multi_select", {"options": [{"id": "x", "name": "X"}, {"id": "y", "name": "Y"}]}
    )
    link = await field("Link", "url")
    made = await field("Made", "date", {"include_time": False, "fill": "created"})
    due = await field("Due", "date", {"include_time": True, "fill": "created"}, semantic="due_date")
    plain = await field("Plain", "date", {"include_time": False})
    tick = await field("Tick", "checkbox", required=True)
    status = await field(
        "Status",
        "status",
        {"options": [{"id": "s1", "name": "Done", "kind": "done"}, {"id": "s2", "name": "Odd"}]},
    )

    async def record(data: dict[str, Any]) -> uuid.UUID:
        found: uuid.UUID = await conn.fetchval(
            "INSERT INTO records (table_id, data, created_by) VALUES ($1, $2::jsonb, $3)"
            " RETURNING id",
            table,
            json.dumps(data),
            user,
        )
        return found

    full = await record({str(one): "a", str(many): ["x", "y"], str(link): "https://a.example"})
    empty = await record({"other": "kept"})
    return {
        "conn": conn,
        "fields": dict(
            one=one, many=many, link=link, made=made, due=due, plain=plain, tick=tick, status=status
        ),
        "records": {"full": full, "empty": empty},
    }


async def _data(conn: asyncpg.Connection, record_id: uuid.UUID) -> dict[str, Any]:
    parsed: dict[str, Any] = json.loads(
        await conn.fetchval("SELECT data FROM records WHERE id = $1", record_id)
    )
    return parsed


async def _field(conn: asyncpg.Connection, field_id: uuid.UUID) -> asyncpg.Record:
    row = await conn.fetchrow("SELECT * FROM fields WHERE id = $1", field_id)
    assert row is not None
    return row


async def test_the_data_survives_the_move_and_the_way_back(temp_database_url: str) -> None:
    assert run_alembic(temp_database_url, "upgrade", "0015").returncode == 0
    conn = await asyncpg.connect(asyncpg_dsn(temp_database_url), timeout=5)
    try:
        seeded = await _seed(conn)
        f, r = seeded["fields"], seeded["records"]

        assert run_alembic(temp_database_url, "upgrade", "head").returncode == 0

        # A single choice is a list of one now. Nothing else of the record changed.
        assert await _data(conn, r["full"]) == {
            str(f["one"]): ["a"],
            str(f["many"]): ["x", "y"],
            str(f["link"]): "https://a.example",
        }
        assert await _data(conn, r["empty"]) == {"other": "kept"}
        versions = {
            row["id"]: row["version"] for row in await conn.fetch("SELECT id, version FROM records")
        }
        assert versions[r["full"]] == 2  # a page that still holds the old shape is refused
        assert versions[r["empty"]] == 1

        one = await _field(conn, f["one"])
        assert one["type"] == "select" and json.loads(one["config"])["multiple"] is False
        many = await _field(conn, f["many"])
        assert many["type"] == "select" and json.loads(many["config"])["multiple"] is True
        link = await _field(conn, f["link"])
        assert link["type"] == "text"
        assert json.loads(link["config"]) == {"format": "url", "max_length": 2048}

        # `fill` goes: a plain date column becomes created_time, one with a role stays a date.
        made = await _field(conn, f["made"])
        assert made["type"] == "created_time" and json.loads(made["config"]) == {}
        due = await _field(conn, f["due"])
        assert due["type"] == "date" and json.loads(due["config"]) == {"include_time": True}
        plain = await _field(conn, f["plain"])
        assert plain["type"] == "date" and json.loads(plain["config"]) == {"include_time": False}

        # A checkbox cannot be required.
        assert (await _field(conn, f["tick"]))["is_required"] is False

        # Every option has a color: the given one is kept, the others get one.
        options = {o["id"]: o for o in json.loads(one["config"])["options"]}
        assert options["b"]["color"] == "#123456"
        assert options["a"]["color"] == "#e5484d"
        status_options = {
            o["id"]: o for o in json.loads((await _field(conn, f["status"]))["config"])["options"]
        }
        assert status_options["s1"]["color"] == "#46a758"  # the color of kind "done"
        assert status_options["s2"]["color"] == "#f76808"  # no kind in the data: palette[1]

        # The new columns have their defaults.
        assert one["is_unique"] is False and one["default_value"] is None
        assert one["description"] is None

        # And back.
        assert run_alembic(temp_database_url, "downgrade", "0015").returncode == 0
        assert await _data(conn, r["full"]) == {
            str(f["one"]): "a",
            str(f["many"]): ["x", "y"],
            str(f["link"]): "https://a.example",
        }
        assert (await _field(conn, f["one"]))["type"] == "single_select"
        assert (await _field(conn, f["many"]))["type"] == "multi_select"
        back = await _field(conn, f["link"])
        assert back["type"] == "url" and json.loads(back["config"]) == {}
        columns = {
            row["column_name"]
            for row in await conn.fetch(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'fields'"
            )
        }
        assert columns.isdisjoint({"is_unique", "default_value", "description"})
    finally:
        await conn.close()


async def test_an_empty_single_choice_goes_back_as_no_value(temp_database_url: str) -> None:
    assert run_alembic(temp_database_url, "upgrade", "head").returncode == 0
    conn = await asyncpg.connect(asyncpg_dsn(temp_database_url), timeout=5)
    try:
        org = await conn.fetchval("INSERT INTO organizations (name) VALUES ('A') RETURNING id")
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
        select = await conn.fetchval(
            "INSERT INTO fields (table_id, name, type, config) VALUES ($1, 'S', 'select',"
            ' \'{"options": [], "multiple": false}\'::jsonb) RETURNING id',
            table,
        )
        record = await conn.fetchval(
            "INSERT INTO records (table_id, data, created_by) VALUES ($1, $2::jsonb, $3)"
            " RETURNING id",
            table,
            json.dumps({str(select): []}),
            user,
        )
        assert run_alembic(temp_database_url, "downgrade", "0015").returncode == 0
        assert await _data(conn, record) == {}
    finally:
        await conn.close()
