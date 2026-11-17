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


async def timer(
    work: Work,
    record: dict[str, Any],
    who: str,
    action: str,
    *,
    field_id: str | None = None,
    **headers: Any,
) -> Any:
    version = headers.get("version", record["version"])
    body: dict[str, Any] = {"action": action}
    if field_id is not None:
        body["field_id"] = field_id
    return await work.api(
        "POST",
        f"/records/{record['id']}/timer",
        who,
        json=body,
        headers={"If-Match": f'"{version}"'},
    )


async def given(board: Board) -> dict[str, Any]:
    """A task the admin created and gave to `member`."""
    return await board.create(Name="Count stock", Assignee=[board.user("member")])


async def test_the_tasks_template_has_one_timer_column(board: Board) -> None:
    assert "Timer" in board.f
    # One column now, not a pair of date columns.
    assert "Started at" not in board.f
    assert "Finished at" not in board.f


async def test_start_then_stop_stamps_both_moments_and_asks_for_review(board: Board) -> None:
    work = board.work
    task = await given(board)

    began = await timer(work, task, "admin", "start")
    assert began.status_code == 200, began.text
    cell = began.json()["data"][board.f["Timer"]]
    assert cell["started_at"].endswith("Z")
    assert "finished_at" not in cell
    assert (await status_of(work, board, task))[0] == "In progress"

    ended = await timer(work, began.json(), "member", "stop")
    assert ended.status_code == 200, ended.text
    cell = ended.json()["data"][board.f["Timer"]]
    assert cell["finished_at"] >= cell["started_at"]
    # Stopping keeps the moment of the start.
    assert cell["started_at"] == began.json()["data"][board.f["Timer"]]["started_at"]
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


async def test_a_table_without_a_timer_column_says_so(work: Work) -> None:
    base_id = await work.make_base()
    plain = Board(work, await work.make_table(base_id, "Notes"))
    task = await plain.create(Name="Just a note")
    assert_problem(await timer(work, task, "admin", "start"), 409)


async def test_the_timer_column_is_hidden_from_a_person_who_may_not_see_them(
    board: Board,
) -> None:
    work = board.work
    task = await given(board)
    await work.api(
        "PUT",
        f"/fields/{board.f['Timer']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert_problem(await timer(work, task, "member", "stop"), 403)


async def add_timer(board: Board, name: str, **extra: Any) -> str:
    created = await board.work.api(
        "POST", f"/tables/{board.id}/fields", json={"name": name, "type": "timer", **extra}
    )
    assert created.status_code == 201, created.text
    field_id: str = created.json()["id"]
    board.f[name] = field_id
    return field_id


async def test_a_timer_cannot_be_written_by_hand(board: Board) -> None:
    work = board.work
    task = await given(board)
    edited = await work.api(
        "PATCH",
        f"/records/{task['id']}",
        json={"data": {board.f["Timer"]: {"started_at": "2026-11-14T08:00:00Z"}}},
        headers={"If-Match": f'"{task["version"]}"'},
    )
    assert_problem(edited, 422)


async def test_a_timer_cannot_be_required(board: Board) -> None:
    created = await board.work.api(
        "POST",
        f"/tables/{board.id}/fields",
        json={"name": "Second", "type": "timer", "is_required": True},
    )
    assert_problem(created, 422)
    patched = await board.work.api(
        "PATCH", f"/fields/{board.f['Timer']}", json={"is_required": True}
    )
    assert_problem(patched, 422)


async def test_a_table_can_have_several_timers_and_the_request_names_one(board: Board) -> None:
    work = board.work
    second = await add_timer(board, "Review time")
    task = await given(board)

    # Two timers: the request has to say which.
    assert_problem(await timer(work, task, "admin", "start"), 422)

    began = await timer(work, task, "admin", "start", field_id=second)
    assert began.status_code == 200, began.text
    data = began.json()["data"]
    assert data[second]["started_at"].endswith("Z")
    assert board.f["Timer"] not in data

    # The first timer is still idle: it can start on its own.
    first = await timer(work, began.json(), "admin", "start", field_id=board.f["Timer"])
    assert first.status_code == 200, first.text


async def test_a_field_id_that_is_not_a_timer_is_refused(board: Board) -> None:
    task = await given(board)
    assert_problem(await timer(board.work, task, "admin", "start", field_id=board.f["Name"]), 404)
