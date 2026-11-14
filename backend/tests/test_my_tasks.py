"""Assigned to me and Today's tasks (UC-K9): tasks of many tables in one list."""

import base64
import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.work_world import Work


async def make_board(work: Work, name: str, base: str | None = None) -> Board:
    base_id = base or await work.make_base(f"Base {name}")
    return Board(work, await work.make_table(base_id, name, template="tasks"))


async def mine(work: Work, who: str, **params: Any) -> Any:
    return await work.api("GET", "/me/tasks", who, params=params)


async def names(work: Work, who: str, **params: Any) -> list[str]:
    response = await mine(work, who, **params)
    assert response.status_code == 200, response.text
    return [t["name"] for t in response.json()["items"]]


async def test_tasks_of_several_tables_come_in_one_list(work: Work) -> None:
    sales = await make_board(work, "Sales")
    ops = await make_board(work, "Ops")
    await sales.create(Name="Call client", Assignee=[sales.user("member")])
    await ops.create(Name="Fix router", Assignee=[ops.user("member")])
    await ops.create(Name="Not mine", Assignee=[ops.user("member2")])
    await ops.create(Name="Nobody")

    # Newest first, from both tables, with the table they come from.
    assert await names(work, "member") == ["Fix router", "Call client"]
    items = (await mine(work, "member")).json()["items"]
    assert [(t["table_name"], t["table_id"]) for t in items] == [
        ("Ops", ops.id),
        ("Sales", sales.id),
    ]
    assert await names(work, "member2") == ["Not mine"]
    assert await names(work, "viewer") == []


async def test_status_and_due_date_are_shown(work: Work) -> None:
    board = await make_board(work, "Sales")
    await board.create(
        Name="Call client",
        Assignee=[board.user("member")],
        Status=board.status_options["In progress"],
        **{"Due date": "2026-11-13"},
    )
    await board.create(Name="Plain", Assignee=[board.user("member")])

    plain, call = (await mine(work, "member")).json()["items"]
    assert call["status"] == {"name": "In progress", "kind": "in_progress"}
    assert call["due_date"] == "2026-11-13"
    assert (plain["status"], plain["due_date"]) == (None, None)


async def test_todays_tasks_are_the_ones_due_on_the_callers_day(work: Work) -> None:
    board = await make_board(work, "Sales")
    mine_id = board.user("member")
    await board.create(Name="Today", Assignee=[mine_id], **{"Due date": "2026-11-13"})
    await board.create(Name="Tomorrow", Assignee=[mine_id], **{"Due date": "2026-11-14"})
    await board.create(Name="No date", Assignee=[mine_id])
    await board.create(
        Name="Someone else's", Assignee=[board.user("member2")], **{"Due date": "2026-11-13"}
    )

    assert await names(work, "member", scope="today", date="2026-11-13") == ["Today"]
    assert await names(work, "member", scope="today", date="2026-11-14") == ["Tomorrow"]
    assert await names(work, "member", scope="today", date="2030-01-01") == []
    assert len(await names(work, "member")) == 3  # no scope: everything assigned to me


async def test_the_day_is_checked(work: Work) -> None:
    for bad in ("tomorrow", "2026-13-40", "13/11/2026", "2026-1-1", ""):
        assert_problem(await mine(work, "member", scope="today", date=bad), 422)
    assert_problem(await mine(work, "member", scope="yesterday"), 422)
    assert (await mine(work, "member", scope="today")).status_code == 200  # the server's day


async def test_a_task_that_was_taken_away_or_deleted_leaves_the_list(work: Work) -> None:
    board = await make_board(work, "Sales")
    moved = await board.create(Name="Moved", Assignee=[board.user("member")])
    gone = await board.create(Name="Gone", Assignee=[board.user("member")])
    await board.create(Name="Kept", Assignee=[board.user("member")])
    assert (await board.patch(moved, "admin", Assignee=[board.user("member2")])).status_code == 200
    assert (await work.api("DELETE", f"/records/{gone['id']}", "admin")).status_code == 204

    assert await names(work, "member") == ["Kept"]
    assert await names(work, "member2") == ["Moved"]


async def test_a_deleted_table_takes_its_tasks_out_of_the_list(work: Work) -> None:
    board = await make_board(work, "Sales")
    await board.create(Name="Doomed", Assignee=[board.user("member")])
    assert (await work.api("DELETE", f"/tables/{board.id}", "admin")).status_code == 204
    assert await names(work, "member") == []


async def test_a_hidden_column_is_left_out(work: Work) -> None:
    board = await make_board(work, "Sales")
    await board.create(
        Name="Secret",
        Assignee=[board.user("member")],
        Status=board.status_options["Done"],
        **{"Due date": "2026-11-13"},
    )
    for column in ("Name", "Status", "Due date"):
        hidden = await work.api(
            "PUT",
            f"/fields/{board.f[column]}/access/{board.user('member')}",
            json={"access": "hidden"},
        )
        assert hidden.status_code == 200, hidden.text

    (task,) = (await mine(work, "member")).json()["items"]
    assert (task["name"], task["status"], task["due_date"]) == (None, None, None)
    # A hidden due date cannot be used to find the task by day either: it still lists it by the
    # assignee only if the column is visible, which here it is not.
    shown = await mine(work, "member", scope="today", date="2026-11-13")
    assert [t["name"] for t in shown.json()["items"]] == [None]


async def test_nobody_sees_the_tasks_of_somebody_else(work: Work) -> None:
    board = await make_board(work, "Sales")
    await board.create(Name="Private", Assignee=[board.user("member")])
    for who in ("member2", "admin", "editor", "wsadmin", "other_admin"):
        assert await names(work, who) == [], who


async def test_a_person_who_cannot_open_the_task_does_not_get_it(work: Work) -> None:
    """Named as assignee, but the column does not grant view and they are not in the workspace."""
    table = await work.make_table(await work.make_base("Odd"), "Odd")
    who = await work.make_field(
        table["id"],
        "Who",
        "user",
        semantic="assignee",
        grants_view=False,
        config={"multiple": True},
    )
    name = next(f["id"] for f in table["fields"] if f["name"] == "Name")
    created = await work.api(
        "POST",
        f"/tables/{table['id']}/records",
        "admin",
        json={"data": {name: "Cannot open", who["id"]: [str(work.users["member"])]}},
    )
    assert created.status_code == 201, created.text
    opened = await work.api("GET", f"/records/{created.json()['id']}", "member")
    assert opened.status_code == 403  # they really cannot open it ...
    assert await names(work, "member") == []  # ... so it is not listed either
    assert await names(work, "editor") == []


async def test_it_needs_a_login(work: Work) -> None:
    assert_problem(await work.client.get("/api/v1/me/tasks"), 401)


async def test_paging_has_no_gaps_or_repeats(work: Work) -> None:
    board = await make_board(work, "Sales")
    for index in range(5):
        await board.create(Name=f"T{index}", Assignee=[board.user("member")])
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = (await mine(work, "member", **params)).json()
        seen += [t["name"] for t in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == ["T4", "T3", "T2", "T1", "T0"]


@pytest.mark.parametrize("limit", [0, 101])
async def test_the_limit_is_checked(work: Work, limit: int) -> None:
    assert_problem(await mine(work, "member", limit=limit), 422)


@pytest.mark.parametrize(
    "cursor", ["garbage", base64.urlsafe_b64encode(f"x|{uuid.uuid4()}".encode()).decode()]
)
async def test_a_forged_cursor_is_refused(work: Work, cursor: str) -> None:
    assert_problem(await mine(work, "member", cursor=cursor), 422)
