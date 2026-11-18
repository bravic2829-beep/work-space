"""The review columns (a score and two notes): in the template, locked for the one who does the
work, free for the reviewer, and added to the task tables that already exist (migration 0016)."""

import json
import uuid
from typing import Any

import asyncpg
import pytest

from tests.api_helpers import assert_problem
from tests.helpers import asyncpg_dsn, run_alembic
from tests.test_records import Board
from tests.test_sheets import add_member, make_sheet
from tests.work_world import Work

SCORE, MERITS, IMPROVE = "Review score (0-1)", "Review: merits", "Review: to improve"


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


# --- the template -------------------------------------------------------------------------------


async def test_a_new_task_table_has_the_three_review_columns(work: Work, board: Board) -> None:
    fields = (await work.api("GET", f"/tables/{board.id}/fields")).json()
    by_name = {f["name"]: f for f in fields}
    assert (by_name[SCORE]["type"], by_name[SCORE]["semantic"]) == ("number", "review_score")
    assert by_name[SCORE]["config"] == {"precision": 1}
    assert (by_name[MERITS]["type"], by_name[MERITS]["semantic"]) == ("long_text", "review_merits")
    assert by_name[IMPROVE]["semantic"] == "review_improve"
    # They come after the manager's feedback, before the links.
    names = [f["name"] for f in sorted(fields, key=lambda f: f["position"])]
    assert names.index("Manager feedback") < names.index(SCORE) < names.index(IMPROVE)


async def test_a_role_needs_the_right_type_and_is_used_once(work: Work, board: Board) -> None:
    other = await work.make_table(await work.make_base("Plain"), "Blank")
    wrong = await work.api(
        "POST",
        f"/tables/{other['id']}/fields",
        json={"name": "Mark", "type": "text", "semantic": "review_score"},
    )
    assert_problem(wrong, 422)
    mark = await work.api(
        "POST",
        f"/tables/{other['id']}/fields",
        json={"name": "Mark", "type": "number", "semantic": "review_score"},
    )
    assert mark.status_code == 201, mark.text
    again = await work.api(
        "POST",
        f"/tables/{other['id']}/fields",
        json={"name": "Mark 2", "type": "number", "semantic": "review_score"},
    )
    assert_problem(again, 409)


# --- who writes them ----------------------------------------------------------------------------


async def test_the_owner_reads_the_review_but_cannot_write_it(board: Board) -> None:
    await make_sheet(board, "member")
    task = await board.create(
        Name="Plan",
        Assignee=[board.user("member")],
        **{SCORE: 0.8, MERITS: "Clear plan", IMPROVE: "Start earlier"},
    )
    seen = (await board.work.api("GET", f"/records/{task['id']}", "member")).json()
    assert seen["data"][board.f[SCORE]] == 0.8
    assert seen["data"][board.f[MERITS]] == "Clear plan"

    for column, value in ((SCORE, 0.1), (MERITS, "x"), (IMPROVE, "y")):
        assert_problem(await board.patch(task, "member", **{column: value}), 403)
    # They still write their own columns.
    assert (await board.patch(task, "member", **{"Progress update": "Half way"})).status_code == 200


async def test_the_admin_and_a_sheet_manager_write_the_review(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    assert (await add_member(work, sheet["id"], "member2", "manager")).status_code == 200
    task = await board.create(Name="Plan", Assignee=[board.user("member")])

    done = await board.patch(task, "admin", **{SCORE: 0.9, MERITS: "Good"})
    assert done.status_code == 200, done.text
    manager = await board.patch(done.json(), "member2", **{IMPROVE: "Share earlier"})
    assert manager.status_code == 200, manager.text
    data = manager.json()["data"]
    assert (data[board.f[SCORE]], data[board.f[MERITS]], data[board.f[IMPROVE]]) == (
        0.9,
        "Good",
        "Share earlier",
    )


# --- migration 0016 -----------------------------------------------------------------------------


async def test_the_columns_are_added_to_task_tables_that_exist(temp_database_url: str) -> None:
    assert run_alembic(temp_database_url, "upgrade", "0015").returncode == 0
    conn = await asyncpg.connect(asyncpg_dsn(temp_database_url), timeout=5)
    try:
        org = await conn.fetchval("INSERT INTO organizations (name) VALUES ('Acme') RETURNING id")
        workspace = await conn.fetchval(
            "INSERT INTO workspaces (organization_id, name, kind)"
            " VALUES ($1, 'W', 'shared') RETURNING id",
            org,
        )
        base = await conn.fetchval(
            "INSERT INTO bases (workspace_id, name) VALUES ($1, 'B') RETURNING id", workspace
        )

        async def table(name: str, *, task: bool, deleted: bool = False) -> uuid.UUID:
            found: uuid.UUID = await conn.fetchval(
                "INSERT INTO tables (base_id, name, deleted_at)"
                " VALUES ($1, $2, CASE WHEN $3 THEN now() END) RETURNING id",
                base,
                name,
                deleted,
            )
            await conn.execute(
                "INSERT INTO fields (table_id, name, type, semantic, position)"
                " VALUES ($1, 'Name', 'text', NULL, 1)",
                found,
            )
            if task:
                options = json.dumps({"options": [{"id": "a", "name": "To do", "kind": "todo"}]})
                await conn.execute(
                    "INSERT INTO fields (table_id, name, type, config, semantic, position)"
                    " VALUES ($1, 'Status', 'status', $2::jsonb, 'status', 2),"
                    "        ($1, 'Assignee', 'user', '{}'::jsonb, 'assignee', 3)",
                    found,
                    options,
                )
            return found

        tasks = await table("Tasks", task=True)
        plain = await table("Notes", task=False)
        trashed = await table("Old tasks", task=True, deleted=True)
        # A task table that already has a column with the name of a new one.
        clash = await table("Clash", task=True)
        await conn.execute(
            "INSERT INTO fields (table_id, name, type, position)"
            " VALUES ($1, 'Review: merits', 'text', 9)",
            clash,
        )

        assert run_alembic(temp_database_url, "upgrade", "head").returncode == 0

        async def columns(table_id: uuid.UUID) -> dict[str, tuple[str, str, Any, int]]:
            rows = await conn.fetch(
                "SELECT name, type, semantic, config, position FROM fields"
                " WHERE table_id = $1 AND semantic LIKE 'review_%' ORDER BY position",
                table_id,
            )
            return {
                r["semantic"]: (r["name"], r["type"], json.loads(r["config"]), r["position"])
                for r in rows
            }

        added = await columns(tasks)
        assert added == {
            "review_score": (SCORE, "number", {"precision": 1}, 4),
            "review_merits": (MERITS, "long_text", {}, 5),
            "review_improve": (IMPROVE, "long_text", {}, 6),
        }
        assert await columns(plain) == {}  # not a task table
        assert await columns(trashed) == {}  # in the trash
        assert (await columns(clash))["review_merits"][0] == "Review: merits (review)"

        # Running it again adds nothing (a column with the role is already there).
        assert run_alembic(temp_database_url, "downgrade", "0015").returncode == 0
        assert await columns(tasks) == {}
        assert run_alembic(temp_database_url, "upgrade", "head").returncode == 0
        assert len(await columns(tasks)) == 3
        total = await conn.fetchval("SELECT count(*) FROM fields WHERE semantic = 'review_score'")
        assert total == 2  # Tasks and Clash
    finally:
        await conn.close()
