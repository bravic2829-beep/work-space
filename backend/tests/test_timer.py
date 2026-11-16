"""The task timer: the person who gave the work presses Start, the assignee presses Stop."""

from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_review import inbox_types, status_of
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def timer(work: Work, record: dict[str, Any], who: str, action: str, **headers: Any) -> Any:
    version = headers.get("version", record["version"])
    return await work.api(
        "POST",
        f"/records/{record['id']}/timer",
        who,
        json={"action": action},
        headers={"If-Match": f'"{version}"'},
    )


async def given(board: Board) -> dict[str, Any]:
    """A task the admin created and gave to `member`."""
    return await board.create(Name="Count stock", Assignee=[board.user("member")])


async def test_the_tasks_template_has_the_two_timer_columns(board: Board) -> None:
    assert "Started at" in board.f
    assert "Finished at" in board.f


async def test_start_then_stop_stamps_both_moments_and_asks_for_review(board: Board) -> None:
    work = board.work
    task = await given(board)

    began = await timer(work, task, "admin", "start")
    assert began.status_code == 200, began.text
    assert began.json()["data"][board.f["Started at"]].endswith("Z")
    assert board.f["Finished at"] not in began.json()["data"]
    assert (await status_of(work, board, task))[0] == "In progress"

    ended = await timer(work, began.json(), "member", "stop")
    assert ended.status_code == 200, ended.text
    data = ended.json()["data"]
    assert data[board.f["Finished at"]] >= data[board.f["Started at"]]
    assert (await status_of(work, board, task))[0] == "Pending review"
    # The person who gave the task is told it is ready for review.
    assert "review_requested" in await inbox_types(work, "admin")


async def test_only_the_person_who_gave_the_task_can_start(board: Board) -> None:
    work = board.work
    task = await given(board)
    assert_problem(await timer(work, task, "member", "start"), 403)
    assert_problem(await timer(work, task, "editor", "start"), 403)
    assert (await timer(work, task, "admin", "start")).status_code == 200


async def test_only_an_assignee_can_stop(board: Board) -> None:
    work = board.work
    task = await given(board)
    began = (await timer(work, task, "admin", "start")).json()
    assert_problem(await timer(work, began, "editor", "stop"), 403)
    assert (await timer(work, began, "member", "stop")).status_code == 200


async def test_stop_needs_a_start_and_a_second_start_or_stop_is_refused(board: Board) -> None:
    work = board.work
    task = await given(board)
    assert_problem(await timer(work, task, "member", "stop"), 409)

    began = (await timer(work, task, "admin", "start")).json()
    assert_problem(await timer(work, began, "admin", "start"), 409)

    ended = (await timer(work, began, "member", "stop")).json()
    assert_problem(await timer(work, ended, "member", "stop"), 409)


async def test_a_stale_version_is_refused(board: Board) -> None:
    task = await given(board)
    assert_problem(await timer(board.work, task, "admin", "start", version=99), 412)


async def test_a_table_without_timer_columns_says_so(work: Work) -> None:
    base_id = await work.make_base()
    plain = Board(work, await work.make_table(base_id, "Notes"))
    task = await plain.create(Name="Just a note")
    assert_problem(await timer(work, task, "admin", "start"), 409)


async def test_the_timer_columns_are_hidden_from_a_person_who_may_not_see_them(
    board: Board,
) -> None:
    work = board.work
    task = await given(board)
    await work.api(
        "PUT",
        f"/fields/{board.f['Started at']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert_problem(await timer(work, task, "member", "stop"), 403)
