"""The manager's overview, the new lists of My tasks, and the whole flow from sheet to report."""

from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_review import review
from tests.test_sheets import add_member, make_sheet, sheet_records
from tests.work_world import Work

TODAY = "2026-11-14"


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def overview(board: Board, who: str = "admin") -> dict[str, Any]:
    response = await board.work.api(
        "GET", "/reports/overview", who, params={"table_id": board.id, "date": TODAY}
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def my_tasks(work: Work, who: str, scope: str) -> list[str]:
    response = await work.api("GET", "/me/tasks", who, params={"scope": scope})
    assert response.status_code == 200, response.text
    return [item["name"] for item in response.json()["items"]]


# --- the overview -----------------------------------------------------------------------------


async def test_the_overview_counts_late_waiting_and_who_has_what(board: Board) -> None:
    s = board.status_options
    m, m2 = board.user("member"), board.user("member2")
    await board.create(Name="Late", Assignee=[m], **{"Due date": "2026-11-10"})
    await board.create(
        Name="Late but done", Assignee=[m], Status=s["Done"], **{"Due date": "2026-11-01"}
    )
    await board.create(Name="Today", Assignee=[m2], **{"Due date": TODAY})
    await board.create(Name="Waiting", Assignee=[m2], Status=s["Pending review"])
    await board.create(Name="Nobody's")

    body = await overview(board)
    assert body["total"] == 5
    assert (body["open"], body["done"], body["in_review"]) == (4, 1, 1)
    assert (body["overdue"], body["due_today"], body["unassigned"]) == (1, 1, 1)
    assert {c["name"]: c["count"] for c in body["by_status"]}["Done"] == 1
    people = {p["user_id"]: p for p in body["people"]}
    assert (people[m]["open"], people[m]["overdue"], people[m]["done"]) == (1, 1, 1)
    assert (people[m2]["open"], people[m2]["in_review"]) == (2, 1)
    # The most late person first.
    assert body["people"][0]["user_id"] == m


async def test_the_overview_only_counts_what_the_reader_may_open(board: Board) -> None:
    await make_sheet(board, "member")
    await board.create(Name="Mine", Assignee=[board.user("member")])
    await board.create(Name="Not mine", Assignee=[board.user("member2")])
    assert (await overview(board, "admin"))["total"] == 2
    seen = await overview(board, "member")
    assert seen["total"] == 1
    assert [p["user_id"] for p in seen["people"]] == [board.user("member")]
    # member2 only sees the one task given to them.
    assert (await overview(board, "member2"))["total"] == 1
    # Another company does not even know the table exists.
    assert_problem(
        await board.work.api(
            "GET", "/reports/overview", "other_admin", params={"table_id": board.id}
        ),
        404,
    )


async def test_somebody_with_no_way_into_the_table_gets_no_report(board: Board) -> None:
    await board.create(Name="Not theirs", Assignee=[board.user("member")])
    assert_problem(
        await board.work.api("GET", "/reports/overview", "member2", params={"table_id": board.id}),
        403,
    )


async def test_a_hidden_column_gives_no_number(board: Board) -> None:
    work = board.work
    await board.create(Name="Late", **{"Due date": "2026-11-10"})
    await work.api(
        "PUT",
        f"/fields/{board.f['Due date']}/access/{board.user('viewer')}",
        json={"access": "hidden"},
    )
    seen = await overview(board, "viewer")
    assert seen["overdue"] is None and seen["due_today"] is None
    assert seen["total"] == 1


async def test_report_tables_are_the_task_tables_the_person_can_open(
    board: Board, work: Work
) -> None:
    await work.make_table(await work.make_base("Notes"), "Notes")  # not a task table
    ids = [t["id"] for t in (await work.api("GET", "/reports/tables")).json()]
    assert ids == [board.id]
    assert (await work.api("GET", "/reports/tables", "member")).json() == []
    await make_sheet(board, "member")
    assert [t["id"] for t in (await work.api("GET", "/reports/tables", "member")).json()] == [
        board.id
    ]


# --- my tasks: following and waiting for my review ----------------------------------------------


async def test_my_tasks_lists_what_i_follow_and_what_waits_for_my_review(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await add_member(work, sheet["id"], "member2", "manager")
    task = await board.create(
        Name="Shopee", Assignee=[board.user("member")], Follower=[board.user("member2")]
    )
    await board.create(Name="Other", Assignee=[board.user("member")])

    assert await my_tasks(work, "member2", "following") == ["Shopee"]
    assert await my_tasks(work, "member2", "review") == []
    await review(work, task, "member", "submit")
    # The creator (admin) and the sheet's manager both review it; the assignee does not.
    assert await my_tasks(work, "admin", "review") == ["Shopee"]
    assert await my_tasks(work, "member2", "review") == ["Shopee"]
    assert await my_tasks(work, "member", "review") == []


# --- the whole flow -----------------------------------------------------------------------------


async def test_admin_to_report_end_to_end(board: Board) -> None:
    """Admin makes a sheet, shares it, gives a task; the employee updates and reports it done;
    the manager approves; the report shows it."""
    work = board.work
    sheet = await make_sheet(board, "member")
    assert (await add_member(work, sheet["id"], "member2", "manager")).status_code == 200

    made = await work.api(
        "POST",
        f"/sheets/{sheet['id']}/records",
        "admin",
        json={"data": {board.f["Name"]: "Đối soát doanh thu Shopee tháng 10"}},
    )
    assert made.status_code == 201, made.text
    task = made.json()
    assert [r["id"] for r in await sheet_records(work, sheet["id"], "member")] == [task["id"]]

    updated = await board.patch(task, "member", **{"Progress update": "Đã đối chiếu 70%"})
    assert updated.status_code == 200, updated.text
    submitted = await review(work, updated.json(), "member", "submit")
    assert submitted.status_code == 200, submitted.text
    assert (await overview(board, "member2"))["in_review"] == 1

    approved = await review(work, submitted.json(), "member2", "approve")
    assert approved.status_code == 200, approved.text
    report = await overview(board, "admin")
    assert (report["done"], report["in_review"], report["open"]) == (1, 0, 0)
    actions = [
        e["action"] for e in (await work.api("GET", f"/records/{task['id']}/activity")).json()
    ]
    assert actions == ["approved", "submitted", "updated", "created"]
