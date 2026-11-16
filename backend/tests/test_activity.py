"""The history of a task, and handing a task over."""

from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_review import review
from tests.test_sheets import add_member, make_sheet
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def history(work: Work, record_id: str, who: str = "admin") -> list[dict[str, Any]]:
    response = await work.api("GET", f"/records/{record_id}/activity", who)
    assert response.status_code == 200, response.text
    body: list[dict[str, Any]] = response.json()
    return body


async def hand_over(board: Board, record: dict[str, Any], who: str, to: str, **extra: Any) -> Any:
    return await board.work.api(
        "POST",
        f"/records/{record['id']}/handover",
        who,
        json={"to_user_id": board.user(to), "result": "Half of the SKUs are done.", **extra},
        headers={"If-Match": f'"{record["version"]}"'},
    )


# --- history ----------------------------------------------------------------------------------


async def test_every_step_of_a_task_is_written_down(board: Board) -> None:
    work = board.work
    task = await board.create(Name="Reconcile Shopee", Assignee=[board.user("member")])
    renamed = (await board.patch(task, "admin", Name="Reconcile Shopee revenue")).json()
    submitted = (await review(work, renamed, "member", "submit")).json()
    await review(work, submitted, "admin", "reject", reason="Add the refunds.")

    entries = await history(work, task["id"])
    assert [e["action"] for e in entries] == ["sent_back", "submitted", "updated", "created"]
    assert entries[0]["note"] == "Add the refunds."
    assert entries[0]["actor"]["id"] == board.user("admin")
    assert entries[1]["actor"]["id"] == board.user("member")
    change = entries[2]["changes"][0]
    assert change["field_name"] == "Name"
    assert (change["before"], change["after"]) == ("Reconcile Shopee", "Reconcile Shopee revenue")


async def test_the_history_hides_what_the_reader_may_not_see(board: Board) -> None:
    work = board.work
    task = await board.create(Name="Plan", **{"Manager feedback": "secret note"})
    await board.patch(task, "admin", **{"Manager feedback": "another secret"})
    await work.api(
        "PUT",
        f"/fields/{board.f['Manager feedback']}/access/{board.user('viewer')}",
        json={"access": "hidden"},
    )
    seen = await history(work, task["id"], "viewer")
    # The update only touched the hidden column: the viewer is not told about it at all.
    assert [e["action"] for e in seen] == ["created"]
    assert all(c["field_name"] != "Manager feedback" for c in seen[0]["changes"])
    full = await history(work, task["id"], "admin")
    assert [e["action"] for e in full] == ["updated", "created"]


async def test_a_stranger_cannot_read_the_history(board: Board) -> None:
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    assert_problem(await board.work.api("GET", f"/records/{task['id']}/activity", "member2"), 403)


# --- handover ---------------------------------------------------------------------------------


async def test_the_assignee_hands_over_to_a_colleague_who_can_open_the_table(
    board: Board,
) -> None:
    work = board.work
    await make_sheet(board, "member")
    await make_sheet(board, "member2")
    task = await board.create(Name="Count stock", Assignee=[board.user("member")])

    done = await hand_over(board, task, "member", "member2", documents="stock.xlsx")
    assert done.status_code == 200, done.text
    assert done.json()["data"][board.f["Assignee"]] == [board.user("member2")]
    # Written down, with the result and the documents, and the new person is told.
    entry = (await history(work, task["id"]))[0]
    assert entry["action"] == "handed_over"
    assert "Half of the SKUs are done." in entry["note"]
    assert "stock.xlsx" in entry["note"]
    notes = (await work.api("GET", "/notifications", "member2")).json()["items"]
    assert [n["type"] for n in notes] == ["task_assigned"]
    # The task is now on the other sheet, and the first person no longer has it.
    assert_problem(await work.api("GET", f"/records/{task['id']}", "member"), 403)


async def test_handing_over_never_gives_access_by_itself(board: Board) -> None:
    await make_sheet(board, "member")
    task = await board.create(Name="Count stock", Assignee=[board.user("member")])
    # member2 is not in the workspace and has no sheet of this table.
    refused = await hand_over(board, task, "member", "member2")
    assert_problem(refused, 422)
    assert (await board.work.api("GET", f"/records/{task['id']}")).json()["data"][
        board.f["Assignee"]
    ] == [board.user("member")]


async def test_only_people_with_a_say_hand_a_task_over(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await add_member(work, sheet["id"], "member2", "viewer")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    # A viewer of the sheet may not; the workspace editor may.
    assert_problem(await hand_over(board, task, "member2", "editor"), 403)
    assert (await hand_over(board, task, "editor", "editor")).status_code == 200


async def test_a_handover_needs_a_result_and_is_not_done_twice(board: Board) -> None:
    await make_sheet(board, "member")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    assert_problem(await hand_over(board, task, "member", "editor", result="   "), 422)
    first = await hand_over(board, task, "admin", "editor")
    assert first.status_code == 200
    # The same request again carries the old version: refused, not handed over twice.
    assert_problem(await hand_over(board, task, "admin", "editor"), 412)
    handovers = [e for e in await history(board.work, task["id"]) if e["action"] == "handed_over"]
    assert len(handovers) == 1
    # The person who handed it over (and is no longer on it) cannot open it any more.
    assert_problem(await board.work.api("GET", f"/records/{task['id']}", "member"), 403)
    # Handing over to the person who already has it is refused too.
    assert_problem(await hand_over(board, first.json(), "admin", "editor"), 409)
