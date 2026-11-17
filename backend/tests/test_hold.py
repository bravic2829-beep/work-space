"""Pause, report a blocker, resume: tasks that are open but not moving."""

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


async def hold(
    work: Work,
    record: dict[str, Any],
    who: str,
    action: str,
    *,
    reason: str | None = "Waiting for the price list.",
) -> Any:
    body: dict[str, Any] = {"action": action}
    if reason is not None and action == "block":
        body["reason"] = reason
    return await work.api(
        "POST",
        f"/records/{record['id']}/review",
        who,
        json=body,
        headers={"If-Match": f'"{record["version"]}"'},
    )


async def started(work: Work, board: Board) -> dict[str, Any]:
    return await board.create(
        Name="Launch",
        Assignee=[board.user("member")],
        Status=board.status_options["In progress"],
    )


async def history(work: Work, record: dict[str, Any]) -> list[dict[str, Any]]:
    """The history of a task, newest first."""
    response = await work.api("GET", f"/records/{record['id']}/activity", "admin")
    assert response.status_code == 200, response.text
    entries: list[dict[str, Any]] = response.json()
    return entries


# --- the template and the existing columns ----------------------------------------------------


async def test_a_new_task_table_has_paused_and_blocked(board: Board) -> None:
    assert {"Paused", "Blocked"} <= set(board.status_options)


# --- pause and resume -------------------------------------------------------------------------


async def test_the_assignee_pauses_and_resumes(work: Work, board: Board) -> None:
    task = await started(work, board)

    paused = await hold(work, task, "member", "pause")
    assert paused.status_code == 200, paused.text
    assert (await status_of(work, board, task))[0] == "Paused"

    resumed = await hold(work, paused.json(), "member", "resume")
    assert resumed.status_code == 200, resumed.text
    assert (await status_of(work, board, task))[0] == "In progress"
    assert [e["action"] for e in await history(work, task)][:2] == ["resumed", "paused"]


async def test_a_task_that_has_not_started_can_be_paused(work: Work, board: Board) -> None:
    task = await board.create(Name="Later", Assignee=[board.user("member")])
    assert (await hold(work, task, "member", "pause")).status_code == 200
    assert (await status_of(work, board, task))[0] == "Paused"


async def test_who_may_pause(work: Work, board: Board) -> None:
    task = await started(work, board)
    # Not assigned and not the creator: refused, whatever their role in the workspace.
    for who in ("member2", "editor", "viewer"):
        response = await hold(work, task, who, "pause")
        assert response.status_code == 403, (who, response.text)
    assert (await status_of(work, board, task))[0] == "In progress"
    # The creator (here the admin) may, even though they are not assigned.
    assert (await hold(work, task, "admin", "pause")).status_code == 200


async def test_pause_and_resume_need_the_right_state(work: Work, board: Board) -> None:
    task = await started(work, board)
    assert_problem(await hold(work, task, "member", "resume"), 409)  # not paused

    paused = (await hold(work, task, "member", "pause")).json()
    assert_problem(await hold(work, paused, "member", "pause"), 409)  # twice

    submitted_task = await started(work, board)
    await work.api(
        "POST",
        f"/records/{submitted_task['id']}/review",
        "member",
        json={"action": "submit"},
        headers={"If-Match": f'"{submitted_task["version"]}"'},
    )
    waiting = (await work.api("GET", f"/records/{submitted_task['id']}", "admin")).json()
    assert_problem(await hold(work, waiting, "member", "pause"), 409)  # in review


async def test_the_same_pause_sent_twice_happens_once(work: Work, board: Board) -> None:
    task = await started(work, board)
    assert (await hold(work, task, "member", "pause")).status_code == 200
    assert_problem(await hold(work, task, "member", "pause"), 412)  # an old version


# --- blockers ---------------------------------------------------------------------------------


async def test_a_blocker_needs_a_reason_and_tells_the_creator(work: Work, board: Board) -> None:
    task = await started(work, board)
    assert_problem(await hold(work, task, "member", "block", reason=None), 422)
    assert_problem(await hold(work, task, "member", "block", reason="   "), 422)
    assert (await status_of(work, board, task))[0] == "In progress"

    blocked = await hold(work, task, "member", "block")
    assert blocked.status_code == 200, blocked.text
    assert (await status_of(work, board, task))[0] == "Blocked"

    # The creator is told; the person who reported it is not told about their own action.
    notes = (await work.api("GET", "/notifications", "admin")).json()["items"]
    assert [n["type"] for n in notes] == ["task_blocked"]
    assert notes[0]["actor"]["id"] == board.user("member")
    assert "task_blocked" not in await inbox_types(work, "member")

    # The reason is on the task as a comment and in the history.
    comments = (await work.api("GET", f"/records/{task['id']}/comments", "admin")).json()
    assert "Blocked: Waiting for the price list." in [c["body"] for c in comments["items"]]
    entries = await history(work, task)
    assert entries[0]["action"] == "blocked"
    assert entries[0]["note"] == "Waiting for the price list."


async def test_the_other_assignees_are_told_of_a_blocker(work: Work, board: Board) -> None:
    task = await board.create(
        Name="Launch",
        Assignee=[board.user("member"), board.user("member2")],
        Status=board.status_options["In progress"],
    )
    assert (await hold(work, task, "member", "block")).status_code == 200
    assert "task_blocked" in await inbox_types(work, "member2")
    assert "task_blocked" not in await inbox_types(work, "member")  # their own report


async def test_a_blocked_task_is_resumed_by_the_creator(work: Work, board: Board) -> None:
    task = await started(work, board)
    blocked = (await hold(work, task, "member", "block")).json()

    assert_problem(await hold(work, blocked, "member", "block"), 409)  # already blocked
    assert_problem(await hold(work, blocked, "member", "pause"), 409)  # blocked, not waiting
    resumed = await hold(work, blocked, "admin", "resume")
    assert resumed.status_code == 200, resumed.text
    assert (await status_of(work, board, task))[0] == "In progress"


async def test_a_task_in_review_or_done_cannot_be_blocked(work: Work, board: Board) -> None:
    task = await started(work, board)
    submitted = await work.api(
        "POST",
        f"/records/{task['id']}/review",
        "member",
        json={"action": "submit"},
        headers={"If-Match": f'"{task["version"]}"'},
    )
    assert submitted.status_code == 200, submitted.text
    assert_problem(await hold(work, submitted.json(), "member", "block"), 409)


async def test_a_blocked_task_can_still_be_reported_as_done(work: Work, board: Board) -> None:
    task = await started(work, board)
    blocked = (await hold(work, task, "member", "block")).json()
    submitted = await work.api(
        "POST",
        f"/records/{task['id']}/review",
        "member",
        json={"action": "submit"},
        headers={"If-Match": f'"{blocked["version"]}"'},
    )
    assert submitted.status_code == 200, submitted.text
    assert (await status_of(work, board, task))[0] == "Pending review"


# --- tables whose status has no such option ---------------------------------------------------


async def test_a_status_without_a_blocked_option_is_a_conflict(work: Work, board: Board) -> None:
    fields = (await work.api("GET", f"/tables/{board.id}/fields", "admin")).json()
    status = next(f for f in fields if f["name"] == "Status")
    kept = [o for o in status["config"]["options"] if o["kind"] != "blocked"]
    changed = await work.api(
        "PATCH", f"/fields/{status['id']}", "admin", json={"config": {"options": kept}}
    )
    assert changed.status_code == 200, changed.text

    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    assert_problem(await hold(work, task, "member", "block"), 409)
    assert (await hold(work, task, "member", "pause")).status_code == 200


async def test_a_hidden_status_column_blocks_the_action(work: Work, board: Board) -> None:
    task = await started(work, board)
    hidden = await work.api(
        "PUT",
        f"/fields/{board.f['Status']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert hidden.status_code == 200, hidden.text
    assert_problem(await hold(work, task, "member", "pause"), 403)
    assert_problem(await hold(work, task, "member", "block"), 403)
    assert (await status_of(work, board, task))[0] == "In progress"


async def test_the_action_must_be_known(work: Work, board: Board) -> None:
    task = await started(work, board)
    response = await work.api(
        "POST",
        f"/records/{task['id']}/review",
        "member",
        json={"action": "freeze"},
        headers={"If-Match": f'"{task["version"]}"'},
    )
    assert response.status_code == 422
