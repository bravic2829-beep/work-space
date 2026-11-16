"""Who can see a task: GET /records/{id}/viewers."""

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def viewers(work: Work, record_id: str, who: str) -> dict:  # type: ignore[type-arg]
    response = await work.api("GET", f"/records/{record_id}/viewers", who)
    assert response.status_code == 200, response.text
    body: dict = response.json()  # type: ignore[type-arg]
    return body


async def test_lists_the_creator_the_assignee_and_the_follower(board: Board) -> None:
    work = board.work
    task = await board.create(
        Name="Launch", Assignee=[board.user("member")], Follower=[board.user("member2")]
    )
    body = await viewers(work, task["id"], "admin")

    by_user = {p["user_id"]: p for p in body["people"]}
    assert by_user[board.user("admin")]["reasons"] == ["creator"]
    assert by_user[board.user("member")]["reasons"] == ["assignee"]
    assert by_user[board.user("member")]["field_names"] == ["Assignee"]
    assert by_user[board.user("member2")]["reasons"] == ["follower"]
    # Creator first, then assignees, then followers.
    assert [p["reasons"][0] for p in body["people"]] == ["creator", "assignee", "follower"]
    # The workspace members (its four roles plus the admin who made it) see every task too.
    assert body["workspace_member_count"] == 5
    assert body["workspace_name"]


async def test_someone_who_is_creator_and_assignee_is_listed_once(board: Board) -> None:
    task = await board.create("editor", Name="Mine", Assignee=[board.user("editor")])
    body = await viewers(board.work, task["id"], "editor")
    mine = [p for p in body["people"] if p["user_id"] == board.user("editor")]
    assert len(mine) == 1
    assert mine[0]["reasons"] == ["creator", "assignee"]


async def test_an_assignee_outside_the_workspace_can_look_but_a_stranger_cannot(
    board: Board,
) -> None:
    work = board.work
    task = await board.create(Name="Secret", Assignee=[board.user("member")])
    assert (await viewers(work, task["id"], "member"))["people"]
    assert_problem(await work.api("GET", f"/records/{task['id']}/viewers", "member2"), 403)
    assert_problem(await work.api("GET", f"/records/{task['id']}/viewers", "other_admin"), 404)


async def test_a_column_the_caller_cannot_see_does_not_name_anyone(board: Board) -> None:
    work = board.work
    task = await board.create(
        Name="Plan", Assignee=[board.user("member")], Follower=[board.user("member2")]
    )
    await work.api(
        "PUT",
        f"/fields/{board.f['Follower']}/access/{board.user('viewer')}",
        json={"access": "hidden"},
    )
    seen = await viewers(work, task["id"], "viewer")
    names = {p["user_id"] for p in seen["people"]}
    assert board.user("member") in names
    assert board.user("member2") not in names
    full = await viewers(work, task["id"], "editor")
    assert board.user("member2") in {p["user_id"] for p in full["people"]}


async def test_adding_a_follower_changes_the_list(board: Board) -> None:
    work = board.work
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    assert board.user("member2") not in {
        p["user_id"] for p in (await viewers(work, task["id"], "admin"))["people"]
    }
    patched = await board.patch(task, Follower=[board.user("member2")])
    assert patched.status_code == 200, patched.text
    assert board.user("member2") in {
        p["user_id"] for p in (await viewers(work, task["id"], "admin"))["people"]
    }
    # And the new follower can now open the task.
    assert (await work.api("GET", f"/records/{task['id']}", "member2")).status_code == 200
