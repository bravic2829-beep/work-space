"""Measure the record list on a big table (ADR 0002: JSONB keyed by field id).

Creates a throwaway database on the PostgreSQL server of DATABASE_URL (never the dev database),
fills one table with N records and F fields, and times the real API (through the ASGI app, so
the SQL, the JSON rendering and the permission checks are all included, the network is not).

    cd backend
    .venv/Scripts/python.exe scripts/benchmark_records.py --records 100000 --fields 100

Each query is run once to warm up and then RUNS times. The result is printed as a table, first
without extra indexes and then with the indexes that ADR 0002 proposes.
"""

import argparse
import asyncio
import json
import statistics
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import asyncpg
import httpx
from sqlalchemy.engine import make_url

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.core.config import Settings, get_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.auth.tokens import encode_token  # noqa: E402

SECRET = "benchmark-secret-with-more-than-thirty-two-characters"
RUNS = 5


def dsn(url: str) -> str:
    return make_url(url).set(drivername="postgresql").render_as_string(hide_password=False)


def database_url(name: str) -> str:
    return (
        make_url(get_settings().database_url or "")
        .set(database=name)
        .render_as_string(hide_password=False)
    )


class Schema:
    """The fields of the benchmark table, by kind."""

    def __init__(self, count: int) -> None:
        self.fields: list[dict[str, Any]] = []
        self.by_kind: dict[str, list[str]] = {}
        # (kind, how many) in the order of the columns; the first is the name column.
        plan = [
            ("text", max(count * 30 // 100, 1)),
            ("number", count * 20 // 100),
            ("date", count * 10 // 100),
            ("single_select", count * 10 // 100),
            ("multi_select", count * 10 // 100),
            ("checkbox", count * 10 // 100),
            ("user", count * 5 // 100),
        ]
        position = 0
        for kind, amount in plan:
            for index in range(amount):
                field_id = str(uuid.uuid4())
                config: dict[str, Any] = {}
                if kind in ("single_select", "multi_select"):
                    # Both are the `select` type now; the kind only says how many options a
                    # cell holds, so the old query cases keep their meaning.
                    config = {
                        "options": [
                            {"id": uuid.uuid4().hex, "name": f"Option {n}"} for n in range(5)
                        ],
                        "multiple": kind == "multi_select",
                    }
                if kind == "number":
                    config = {"precision": 0}
                if kind == "date":
                    config = {"include_time": False}
                if kind == "user":
                    config = {"multiple": True}
                self.fields.append(
                    {
                        "id": field_id,
                        "name": f"{kind}_{index}",
                        "kind": kind,
                        "config": config,
                        "position": position,
                        "assignee": kind == "user" and index == 0,
                    }
                )
                self.by_kind.setdefault(kind, []).append(field_id)
                position += 1


def value_sql(field: dict[str, Any], user_ids: list[uuid.UUID]) -> str:
    """A SQL expression that makes a random value for the field (one per generated row)."""
    kind = field["kind"]
    if kind == "text":
        return "'text ' || (random() * 1000)::int"
    if kind == "number":
        return "to_jsonb((random() * 10000)::int)"
    if kind == "date":
        return "to_jsonb(to_char(date '2025-01-01' + (random() * 700)::int, 'YYYY-MM-DD'))"
    if kind in ("single_select", "multi_select"):
        ids = [option["id"] for option in field["config"]["options"]]
        array = "ARRAY[" + ",".join(f"'{i}'" for i in ids) + "]"
        pick = f"({array})[1 + (random() * 4)::int]"
        if kind == "single_select":
            return f"jsonb_build_array({pick})"
        return f"jsonb_build_array({pick}, ({array})[1])"
    if kind == "checkbox":
        return "to_jsonb(random() < 0.5)"
    if kind == "user":
        array = "ARRAY[" + ",".join(f"'{u}'" for u in user_ids) + "]"
        return f"jsonb_build_array(({array})[1 + (random() * {len(user_ids) - 1})::int])"
    raise ValueError(kind)


def row_sql(schema: Schema, user_ids: list[uuid.UUID]) -> str:
    """The `data` expression. jsonb_build_object takes at most 100 arguments, so build in parts."""
    parts: list[str] = []
    chunk: list[str] = []
    for field in schema.fields:
        value = value_sql(field, user_ids)
        if field["kind"] == "text":
            value = f"to_jsonb({value})"
        chunk.append(f"'{field['id']}', {value}")
        if len(chunk) == 25:
            parts.append("jsonb_build_object(" + ", ".join(chunk) + ")")
            chunk = []
    if chunk:
        parts.append("jsonb_build_object(" + ", ".join(chunk) + ")")
    return " || ".join(parts)


async def seed(url: str, records: int, field_count: int) -> dict[str, Any]:
    conn = await asyncpg.connect(dsn(url))
    try:
        org = await conn.fetchval("INSERT INTO organizations (name) VALUES ('Bench') RETURNING id")
        user_ids: list[uuid.UUID] = []
        for number in range(500):
            user_ids.append(
                await conn.fetchval(
                    "INSERT INTO users (organization_id, employee_code, full_name, password_hash,"
                    " org_role, level) VALUES ($1, $2, 'N', 'x', $3, $4) RETURNING id",
                    org,
                    f"U{number}",
                    "admin" if number == 0 else "member",
                    "admin" if number == 0 else "employee",
                )
            )
        workspace = await conn.fetchval(
            "INSERT INTO workspaces (organization_id, name, kind) VALUES ($1, 'W', 'shared')"
            " RETURNING id",
            org,
        )
        base = await conn.fetchval(
            "INSERT INTO bases (workspace_id, name) VALUES ($1, 'B') RETURNING id", workspace
        )
        table = await conn.fetchval(
            "INSERT INTO tables (base_id, name) VALUES ($1, 'Big') RETURNING id", base
        )
        schema = Schema(field_count)
        for field in schema.fields:
            semantic = "assignee" if field["assignee"] else None
            await conn.execute(
                "INSERT INTO fields (id, table_id, name, type, config, semantic, grants_view,"
                " position) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)",
                uuid.UUID(field["id"]),
                table,
                field["name"],
                "select" if field["kind"] in ("single_select", "multi_select") else field["kind"],
                json.dumps(field["config"]),
                semantic,
                field["assignee"],
                field["position"],
            )
        data_sql = row_sql(schema, user_ids[1:])
        batch = 10_000
        started = time.perf_counter()
        for done in range(0, records, batch):
            count = min(batch, records - done)
            await conn.execute(
                f"INSERT INTO records (table_id, data, created_by, created_at) "
                f"SELECT $1, {data_sql}, $2, timestamptz '2026-01-01' + (g + $3) * interval '1 second' "
                f"FROM generate_series(1, $4) g",
                table,
                user_ids[0],
                done,
                count,
            )
            print(f"  seeded {done + count:>7} records ({time.perf_counter() - started:.0f}s)")
        assignee = next(f["id"] for f in schema.fields if f["assignee"])
        await conn.execute(
            "INSERT INTO record_viewers (record_id, user_id, source_key, reason)"
            " SELECT id, created_by, 'creator', 'creator' FROM records WHERE table_id = $1",
            table,
        )
        await conn.execute(
            "INSERT INTO record_viewers (record_id, user_id, source_key, reason, source_field_id)"
            " SELECT r.id, u::uuid, $2, 'field', $3 FROM records r,"
            " jsonb_array_elements_text(r.data -> $2) u WHERE r.table_id = $1"
            " ON CONFLICT DO NOTHING",
            table,
            assignee,
            uuid.UUID(assignee),
        )
        await conn.execute("ANALYZE")
        return {
            "org": org,
            "table": table,
            "users": user_ids,
            "schema": schema,
            "assignee": assignee,
        }
    finally:
        await conn.close()


def token_for(settings: Settings, user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    return encode_token(
        settings,
        user_id=user_id,
        session_id=session_id,
        issued_at=now,
        expires_at=now + timedelta(hours=2),
    )


async def sizes(url: str) -> dict[str, str]:
    conn = await asyncpg.connect(dsn(url))
    try:
        rows = await conn.fetch(
            "SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS total,"
            " pg_size_pretty(pg_relation_size(oid)) AS own "
            "FROM pg_class WHERE relname IN ('records', 'record_viewers')"
        )
        return {r["relname"]: f"{r['own']} data, {r['total']} with indexes" for r in rows}
    finally:
        await conn.close()


class Bench:
    def __init__(
        self, client: httpx.AsyncClient, info: dict[str, Any], headers: dict[str, dict[str, str]]
    ):
        self.client = client
        self.info = info
        self.headers = headers
        self.results: list[tuple[str, float, float, int]] = []

    async def time(self, label: str, who: str, params: dict[str, Any]) -> None:
        url = f"/api/v1/tables/{self.info['table']}/records"
        samples: list[float] = []
        items = 0
        for run in range(RUNS + 1):
            started = time.perf_counter()
            response = await self.client.get(url, params=params, headers=self.headers[who])
            elapsed = (time.perf_counter() - started) * 1000
            if response.status_code != 200:
                raise SystemExit(f"{label}: {response.status_code} {response.text[:300]}")
            items = len(response.json()["items"])
            if run:  # the first run only warms up
                samples.append(elapsed)
        self.results.append((label, statistics.median(samples), max(samples), items))

    def report(self, title: str) -> None:
        print(f"\n### {title}\n")
        print("| Query | median ms | worst ms | rows |")
        print("| --- | ---: | ---: | ---: |")
        for label, median, worst, items in self.results:
            print(f"| {label} | {median:.0f} | {worst:.0f} | {items} |")
        self.results = []


async def run_queries(bench: Bench, deep_cursor: str) -> None:
    schema: Schema = bench.info["schema"]
    text, number, date = (schema.by_kind[k][0] for k in ("text", "number", "date"))
    text2, number2 = schema.by_kind["text"][1], schema.by_kind["number"][1]
    single = schema.by_kind["single_select"][0]
    multi = schema.by_kind["multi_select"][0]
    option = schema.fields[[f["id"] for f in schema.fields].index(single)]["config"]["options"][0][
        "id"
    ]
    multi_option = next(f for f in schema.fields if f["id"] == multi)["config"]["options"][0]["id"]

    def flt(*conditions: dict[str, Any]) -> str:
        return json.dumps(list(conditions))

    def cond(field: str, op: str, value: Any = None) -> dict[str, Any]:
        return {"field": field, "op": op, "value": value}

    cases: list[tuple[str, str, dict[str, Any]]] = [
        ("first page (50 rows), admin", "admin", {"limit": 50}),
        (
            "page at row ~50,000 (keyset cursor), admin",
            "admin",
            {"limit": 50, "cursor": deep_cursor},
        ),
        ("number > 9900 (about 1%)", "admin", {"filter": flt(cond(number, "gt", 9900))}),
        (
            "number > 5000 (about 50%), first page",
            "admin",
            {"filter": flt(cond(number, "gt", 5000))},
        ),
        ("text = 'text 500' (about 0.1%)", "admin", {"filter": flt(cond(text, "eq", "text 500"))}),
        (
            "text contains '99' (about 20%), first page",
            "admin",
            {"filter": flt(cond(text, "contains", "99"))},
        ),
        (
            "single select = option 0 (about 20%), first page",
            "admin",
            {"filter": flt(cond(single, "eq", option))},
        ),
        (
            "multi select contains option 0 (about 40%), first page",
            "admin",
            {"filter": flt(cond(multi, "contains", multi_option))},
        ),
        (
            "date >= 2026-06-01 and number > 9000",
            "admin",
            {"filter": flt(cond(date, "gte", "2026-06-01"), cond(number, "gt", 9000))},
        ),
        ("sort by number asc", "admin", {"sort": f"{number}:asc"}),
        ("sort by number desc", "admin", {"sort": f"{number}:desc"}),
        ("sort by text asc", "admin", {"sort": f"{text}:asc"}),
        (
            "sort by date desc, then number asc",
            "admin",
            {"sort": [f"{date}:desc", f"{number}:asc"]},
        ),
        (
            "filter text contains '99' + sort by number desc",
            "admin",
            {"filter": flt(cond(text, "contains", "99")), "sort": f"{number}:desc"},
        ),
        (
            "filter number > 9900 + sort by text asc",
            "admin",
            {"filter": flt(cond(number, "gt", 9900)), "sort": f"{text}:asc"},
        ),
        ("employee (sees about 1% through record_viewers): first page", "employee", {"limit": 50}),
        ("employee: number > 5000", "employee", {"filter": flt(cond(number, "gt", 5000))}),
        ("employee: sort by number desc", "employee", {"sort": f"{number}:desc"}),
    ]
    _ = (text2, number2)
    for label, who, params in cases:
        await bench.time(label, who, params)


async def main(records: int, field_count: int, keep: bool) -> None:
    name = f"workbase_bench_{uuid.uuid4().hex[:10]}"
    admin = await asyncpg.connect(dsn(get_settings().database_url or ""))
    await admin.execute(f'CREATE DATABASE "{name}"')
    await admin.close()
    url = database_url(name)
    try:
        print(f"database {name}: migrating")
        env = {**__import__("os").environ, "DATABASE_URL": url}
        done = subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if done.returncode:
            raise SystemExit(done.stderr)
        print(f"seeding {records} records x {field_count} fields")
        info = await seed(url, records, field_count)
        print("table sizes:", await sizes(url))

        settings = Settings(
            _env_file=None,
            app_env="test",
            database_url=url,
            jwt_secret=SECRET,
            cors_allowed_origins=["http://localhost:3000"],
        )
        conn = await asyncpg.connect(dsn(url))
        headers: dict[str, dict[str, str]] = {}
        for who, user_id in (("admin", info["users"][0]), ("employee", info["users"][1])):
            session_id = uuid.uuid4()
            await conn.execute(
                "INSERT INTO auth_sessions (id, user_id, remember_me, expires_at)"
                " VALUES ($1, $2, false, now() + interval '2 hours')",
                session_id,
                user_id,
            )
            headers[who] = {
                "Cookie": f"{settings.session_cookie_name}={token_for(settings, user_id, session_id)}"
            }
        # Give the employee exactly the records they are assigned (about 1% of the table).
        employee = info["users"][1]
        seen = await conn.fetchval(
            "SELECT count(*) FROM record_viewers WHERE user_id = $1", employee
        )
        print(f"the employee sees {seen} records through record_viewers")
        row = await conn.fetchrow(
            "SELECT created_at, id FROM records WHERE table_id = $1 ORDER BY created_at, id OFFSET $2 LIMIT 1",
            info["table"],
            records // 2,
        )
        await conn.close()

        from app.modules.records.listing import make_cursor

        signature = "created_at:asc|id:asc"
        deep = make_cursor(signature, [row["created_at"].isoformat(), str(row["id"])])

        app = create_app(settings)
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                bench = Bench(client, info, headers)
                await run_queries(bench, deep)
                bench.report("No extra indexes (what the migration creates)")

                conn = await asyncpg.connect(dsn(url))
                schema: Schema = info["schema"]
                number = schema.by_kind["number"][0]
                text = schema.by_kind["text"][0]
                date = schema.by_kind["date"][0]
                print("\ncreating candidate indexes ...")
                started = time.perf_counter()
                await conn.execute(
                    "CREATE INDEX bench_gin ON records USING gin (data jsonb_path_ops)"
                )
                print(f"  GIN on data: {time.perf_counter() - started:.0f}s")
                for label, ddl in (
                    (
                        "number expr",
                        f"CREATE INDEX bench_num ON records (((data ->> '{number}')::numeric), created_at, id) WHERE deleted_at IS NULL",
                    ),
                    (
                        "text expr",
                        f"CREATE INDEX bench_txt ON records ((data ->> '{text}'), created_at, id) WHERE deleted_at IS NULL",
                    ),
                    (
                        "date expr",
                        f"CREATE INDEX bench_date ON records ((data ->> '{date}'), created_at, id) WHERE deleted_at IS NULL",
                    ),
                ):
                    started = time.perf_counter()
                    await conn.execute(ddl)
                    print(f"  {label}: {time.perf_counter() - started:.0f}s")
                await conn.execute("ANALYZE")
                print("table sizes:", await sizes(url))
                await conn.close()
                await run_queries(bench, deep)
                bench.report("With a GIN index on data and expression indexes on three columns")
    finally:
        if keep:
            print(f"\nkept database {name}")
        else:
            admin = await asyncpg.connect(dsn(get_settings().database_url or ""))
            await admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
            await admin.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--records", type=int, default=100_000)
    parser.add_argument("--fields", type=int, default=100)
    parser.add_argument("--keep", action="store_true", help="do not drop the database at the end")
    args = parser.parse_args()
    asyncio.run(main(args.records, args.fields, args.keep))
