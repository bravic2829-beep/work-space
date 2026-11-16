"""The organization admin is the manager with every right: no step of a task is closed to them."""

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_reports import my_tasks
from tests.test_review import review, status_of
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def someone_elses_task(board: Board) -> dict:  # type: ignore[type-arg]
    """Created by the workspace editor, given to `member`, in progress: nothing to do with admin."""
    return await board.create(
        "editor",
        Name="Shopee",
        Assignee=[board.user("member")],
        Status=board.status_options["In progress"],
    )


async def test_the_admin_reports_reviews_and_sends_back_any_task(board: Board) -> None:
    work = board.work
    task = await someone_elses_task(board)

    submitted = await review(work, task, "admin", "submit")  # on behalf of the assignee
    assert submitted.status_code == 200, submitted.text
    assert await my_tasks(work, "admin", "review") == ["Shopee"]

    back = await review(work, submitted.json(), "admin", "reject", reason="Add the refunds.")
    assert back.status_code == 200, back.text
    again = (await review(work, back.json(), "member", "submit")).json()
    approved = await review(work, again, "admin", "approve")
    assert approved.status_code == 200, approved.text
    assert (await status_of(work, board, task))[0] == "Done"


async def test_the_admin_deletes_any_task_and_any_comment(board: Board) -> None:
    work = board.work
    task = await someone_elses_task(board)
    comment = await work.api(
        "POST", f"/records/{task['id']}/comments", "member", json={"body": "Done soon"}
    )
    assert comment.status_code == 201, comment.text
    assert (await work.api("DELETE", f"/comments/{comment.json()['id']}")).status_code == 204
    assert (await work.api("DELETE", f"/records/{task['id']}")).status_code == 204


async def test_the_others_keep_their_limits(board: Board) -> None:
    work = board.work
    task = await board.create(
        Name="Admin's", Assignee=[board.user("member")], Status=board.status_options["In progress"]
    )
    # Not assigned, not the creator, not an admin: no report, no review, no delete.
    assert_problem(await review(work, task, "editor", "submit"), 403)
    submitted = (await review(work, task, "member", "submit")).json()
    assert_problem(await review(work, submitted, "editor", "approve"), 403)
    assert_problem(await work.api("DELETE", f"/records/{task['id']}", "editor"), 403)
    comment = await work.api("POST", f"/records/{task['id']}/comments", "admin", json={"body": "x"})
    assert_problem(await work.api("DELETE", f"/comments/{comment.json()['id']}", "member"), 403)
    assert await my_tasks(work, "editor", "review") == []
