"""Report done, approve, send back (usecases.md 3.3, UC-K4 to UC-K6 and UC-K8)."""

import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def review(
    work: Work,
    record: dict[str, Any],
    who: str,
    action: str,
    *,
    version: Any = None,
) -> Any:
    return await work.api(
        "POST",
        f"/records/{record['id']}/review",
        who,
        json={"action": action},
        headers={"If-Match": f'"{record["version"] if version is None else version}"'},
    )


async def status_of(work: Work, board: Board, record: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    response = await work.api("GET", f"/records/{record['id']}", "admin")
    body: dict[str, Any] = response.json()
    names = {v: k for k, v in board.status_options.items()}
    return names[body["data"][board.f["Status"]]], body


async def inbox_types(work: Work, who: str) -> list[str]:
    response = await work.api("GET", "/notifications", who)
    return [n["type"] for n in response.json()["items"]]


async def started(work: Work, board: Board, **cells: Any) -> dict[str, Any]:
    """A task created by the admin, assigned to `member`, in progress."""
    return await board.create(
        Name="Launch",
        Assignee=[board.user("member")],
        Status=board.status_options["In progress"],
        **cells,
    )


# --- the whole loop ---------------------------------------------------------------------------


async def test_report_done_then_approve(work: Work, board: Board) -> None:
    task = await started(work, board)
    # The assignee only reads the status column, yet can report the task as done.
    assert_problem(await board.patch(task, "member", Status=board.status_options["Done"]), 403)

    submitted = await review(work, task, "member", "submit")
    assert submitted.status_code == 200, submitted.text
    assert submitted.headers["etag"] == f'"{task["version"] + 1}"'
    assert (await status_of(work, board, task))[0] == "Pending review"
    # The reviewer (who created the task) is told, with the assignee as the actor.
    notes = (await work.api("GET", "/notifications", "admin")).json()["items"]
    assert [n["type"] for n in notes] == ["review_requested"]
    assert notes[0]["actor"]["id"] == board.user("member")
    assert notes[0]["record_id"] == task["id"]

    approved = await review(work, submitted.json(), "admin", "approve")
    assert approved.status_code == 200, approved.text
    assert (await status_of(work, board, task))[0] == "Done"
    # Approving tells nobody: only two events notify (usecases.md 4.7).
    assert await inbox_types(work, "member") == ["task_assigned"]


async def test_the_reviewer_can_send_the_task_back(work: Work, board: Board) -> None:
    task = await started(work, board)
    submitted = (await review(work, task, "member", "submit")).json()

    rejected = await review(work, submitted, "admin", "reject")
    assert rejected.status_code == 200, rejected.text
    assert (await status_of(work, board, task))[0] == "In progress"

    # The assignee can report again after a rejection.
    again = await review(work, rejected.json(), "member", "submit")
    assert again.status_code == 200, again.text
    assert len(await inbox_types(work, "admin")) == 2


async def test_a_task_with_no_status_yet_can_be_reported(work: Work, board: Board) -> None:
    task = await board.create(Name="Fresh", Assignee=[board.user("member")])
    assert (await review(work, task, "member", "submit")).status_code == 200


async def test_a_department_head_sends_the_parent_task_up_for_review(
    work: Work, board: Board
) -> None:
    """UC-K8: the head who received the task reports the parent when the subtasks are done."""
    department = await work.api(
        "POST",
        "/departments",
        json={"name": "Sales", "kind": "division", "head_user_id": board.user("member")},
    )
    assert department.status_code == 201
    parent = await started(work, board)
    sub = await work.api(
        "POST",
        f"/tables/{board.id}/records",
        "member",
        json={
            "data": {
                board.f["Parent task"]: [parent["id"]],
                board.f["Assignee"]: [board.user("member2")],
            }
        },
    )
    assert sub.status_code == 201, sub.text

    current = (await work.api("GET", f"/records/{parent['id']}", "member")).json()
    assert (await review(work, current, "member", "submit")).status_code == 200
    assert await inbox_types(work, "admin") == ["review_requested"]


async def test_nobody_is_notified_about_their_own_report(work: Work, board: Board) -> None:
    task = await board.create(
        "editor",
        Name="Mine",
        Assignee=[board.user("editor")],
        Status=board.status_options["In progress"],
    )
    assert (await review(work, task, "editor", "submit")).status_code == 200
    assert await inbox_types(work, "editor") == []


# --- refused ----------------------------------------------------------------------------------


async def test_only_an_assignee_can_report_done(work: Work, board: Board) -> None:
    task = await started(work, board)
    # Not assigned: another member, a workspace editor, even the admin who created it.
    for who in ("member2", "editor", "admin", "viewer"):
        response = await review(work, task, who, "submit")
        assert response.status_code == 403, (who, response.text)
    assert (await status_of(work, board, task))[0] == "In progress"
    assert await inbox_types(work, "admin") == []


async def test_only_the_creator_can_approve_or_reject(work: Work, board: Board) -> None:
    task = await started(work, board)
    submitted = (await review(work, task, "member", "submit")).json()

    for who in ("member", "editor", "wsadmin", "member2"):
        for action in ("approve", "reject"):
            response = await review(work, submitted, who, action)
            assert response.status_code == 403, (who, action, response.text)
    assert (await status_of(work, board, task))[0] == "Pending review"


async def test_actions_that_do_not_fit_the_state_are_conflicts(work: Work, board: Board) -> None:
    task = await started(work, board)
    # Nothing to approve or reject before it is reported.
    assert_problem(await review(work, task, "admin", "approve"), 409)
    assert_problem(await review(work, task, "admin", "reject"), 409)

    submitted = (await review(work, task, "member", "submit")).json()
    assert_problem(await review(work, submitted, "member", "submit"), 409)  # twice

    done = (await review(work, submitted, "admin", "approve")).json()
    assert_problem(await review(work, done, "member", "submit"), 409)  # already done
    assert_problem(await review(work, done, "admin", "approve"), 409)


async def test_the_version_is_checked(work: Work, board: Board) -> None:
    task = await started(work, board)
    missing = await work.api(
        "POST", f"/records/{task['id']}/review", "member", json={"action": "submit"}
    )
    assert_problem(missing, 428)
    assert_problem(await review(work, task, "member", "submit", version=task["version"] + 5), 412)
    assert (await status_of(work, board, task))[0] == "In progress"


async def test_a_hidden_status_column_blocks_the_action(work: Work, board: Board) -> None:
    task = await started(work, board)
    hidden = await work.api(
        "PUT",
        f"/fields/{board.f['Status']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert hidden.status_code == 200, hidden.text
    assert_problem(await review(work, task, "member", "submit"), 403)
    assert (await status_of(work, board, task))[0] == "In progress"


async def test_a_person_who_cannot_see_the_task_gets_nothing(work: Work, board: Board) -> None:
    task = await started(work, board)
    response = await review(work, task, "member2", "submit")
    assert_problem(response, 403)
    assert_problem(await review(work, task, "other_admin", "submit"), 404)
    missing = await work.api(
        "POST",
        f"/records/{uuid.uuid4()}/review",
        "member",
        json={"action": "submit"},
        headers={"If-Match": '"1"'},
    )
    assert_problem(missing, 404)


async def test_a_table_without_a_status_column_cannot_be_reviewed(work: Work) -> None:
    table = await work.make_table(await work.make_base(), "Plain")
    board = Board(work, table)
    record = await board.create(Name="Plain")
    assert_problem(await review(work, record, "admin", "submit"), 409)


async def test_a_status_without_a_review_option_is_a_conflict(work: Work, board: Board) -> None:
    fields = (await work.api("GET", f"/tables/{board.id}/fields", "admin")).json()
    status = next(f for f in fields if f["name"] == "Status")
    kept = [o for o in status["config"]["options"] if o["kind"] != "review"]
    changed = await work.api(
        "PATCH", f"/fields/{status['id']}", "admin", json={"config": {"options": kept}}
    )
    assert changed.status_code == 200, changed.text

    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    assert_problem(await review(work, task, "member", "submit"), 409)


async def test_the_body_is_strict(work: Work, board: Board) -> None:
    task = await started(work, board)
    headers = {"If-Match": f'"{task["version"]}"'}
    url = f"/records/{task['id']}/review"
    for body in ({"action": "delete"}, {}, {"action": "submit", "status": "x"}):
        response = await work.api("POST", url, "member", json=body, headers=headers)
        assert_problem(response, 422)


async def test_the_review_needs_a_login(work: Work, board: Board) -> None:
    task = await started(work, board)
    response = await work.client.post(
        f"/api/v1/records/{task['id']}/review", json={"action": "submit"}
    )
    assert_problem(response, 401)
