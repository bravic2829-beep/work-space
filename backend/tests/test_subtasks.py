"""A department head who is assigned a task may split it into subtasks (usecases.md 3.2).

The right is narrow: only a subtask of a task that names the caller as assignee, in the same
table, and only for department heads. These tests check what is refused at least as hard as
what is allowed.
"""

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


async def make_head(work: Work, who: str, name: str = "Sales team") -> dict[str, Any]:
    """Make `who` the head of a new department."""
    response = await work.api(
        "POST",
        "/departments",
        json={"name": name, "kind": "division", "head_user_id": str(work.users[who])},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def create_subtask(work: Work, board: Board, who: str, parent: Any, **cells: Any) -> Any:
    data = {board.f[name]: value for name, value in cells.items()}
    data[board.f["Parent task"]] = [parent] if isinstance(parent, str) else parent
    return await work.api("POST", f"/tables/{board.id}/records", who, json={"data": data})


# --- allowed ----------------------------------------------------------------------------------


async def test_assigned_department_head_outside_the_workspace_creates_a_subtask(
    work: Work, board: Board
) -> None:
    await make_head(work, "member")
    task = await board.create(Name="Launch", Assignee=[board.user("member")])

    response = await create_subtask(
        work, board, "member", task["id"], Name="Banner", Assignee=[board.user("member2")]
    )

    assert response.status_code == 201, response.text
    subtask = response.json()
    assert subtask["data"][board.f["Parent task"]] == [task["id"]]
    # The parent shows the new subtask, the head created it, the assignee can open it.
    parent_now = await work.api("GET", f"/records/{task['id']}", "member")
    assert subtask["id"] in parent_now.json()["data"][board.f["Subtasks"]]
    assert (await work.api("GET", f"/records/{subtask['id']}", "member")).status_code == 200
    assert (await work.api("GET", f"/records/{subtask['id']}", "member2")).status_code == 200


async def test_the_head_edits_the_subtask_they_created_but_not_the_parent(
    work: Work, board: Board
) -> None:
    await make_head(work, "member")
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    subtask = (await create_subtask(work, board, "member", task["id"], Name="Banner")).json()

    renamed = await board.patch(subtask, "member", Name="Banner v2")
    assert renamed.status_code == 200, renamed.text

    refused = await board.patch(task, "member", Name="Hijacked")
    assert_problem(refused, 403)


async def test_a_head_with_only_a_commenter_role_can_split_a_task_too(
    work: Work, board: Board
) -> None:
    await make_head(work, "commenter")
    task = await board.create(Name="Launch", Assignee=[board.user("commenter")])
    response = await create_subtask(work, board, "commenter", task["id"], Name="Banner")
    assert response.status_code == 201, response.text


async def test_a_workspace_editor_still_creates_records_freely(work: Work, board: Board) -> None:
    created = await board.create("editor", Name="Free task")
    assert created["data"][board.f["Name"]] == "Free task"


# --- refused ----------------------------------------------------------------------------------


async def test_an_assigned_employee_who_is_not_a_head_cannot_create_a_subtask(
    work: Work, board: Board
) -> None:
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    response = await create_subtask(work, board, "member", task["id"], Name="Banner")
    assert_problem(response, 403)


async def test_a_head_cannot_split_a_task_assigned_to_somebody_else(
    work: Work, board: Board
) -> None:
    await make_head(work, "member")
    task = await board.create(Name="Launch", Assignee=[board.user("member2")])
    response = await create_subtask(work, board, "member", task["id"], Name="Banner")
    assert_problem(response, 403)


async def test_a_head_has_no_general_right_to_create_records(work: Work, board: Board) -> None:
    await make_head(work, "member")
    await board.create(Name="Launch", Assignee=[board.user("member")])

    without_parent = await work.api(
        "POST",
        f"/tables/{board.id}/records",
        "member",
        json={"data": {board.f["Name"]: "Loose task"}},
    )
    assert_problem(without_parent, 403)

    empty_parent = await create_subtask(work, board, "member", [], Name="Loose task")
    assert_problem(empty_parent, 403)


async def test_a_head_cannot_use_a_task_that_does_not_exist_or_is_in_the_trash(
    work: Work, board: Board
) -> None:
    await make_head(work, "member")
    task = await board.create(Name="Old", Assignee=[board.user("member")])

    missing = await create_subtask(work, board, "member", str(uuid.uuid4()), Name="Banner")
    assert_problem(missing, 403)
    not_a_uuid = await create_subtask(work, board, "member", "not-a-uuid", Name="Banner")
    assert_problem(not_a_uuid, 403)

    deleted = await work.api("DELETE", f"/records/{task['id']}", "admin")
    assert deleted.status_code == 204
    in_trash = await create_subtask(work, board, "member", task["id"], Name="Banner")
    assert_problem(in_trash, 403)


async def test_a_head_cannot_name_two_parents(work: Work, board: Board) -> None:
    await make_head(work, "member")
    one = await board.create(Name="One", Assignee=[board.user("member")])
    two = await board.create(Name="Two", Assignee=[board.user("member")])
    response = await create_subtask(work, board, "member", [one["id"], two["id"]], Name="Banner")
    assert_problem(response, 403)


async def test_a_task_from_another_table_does_not_count(work: Work, board: Board) -> None:
    await make_head(work, "member")
    other = Board(work, await work.make_table(await work.make_base("Other"), "Tasks", "tasks"))
    foreign = await other.create(Name="Elsewhere", Assignee=[other.user("member")])
    response = await create_subtask(work, board, "member", foreign["id"], Name="Banner")
    assert_problem(response, 403)


async def test_a_head_who_lost_the_assignment_can_no_longer_split_the_task(
    work: Work, board: Board
) -> None:
    await make_head(work, "member")
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    assert (await create_subtask(work, board, "member", task["id"], Name="A")).status_code == 201

    reassigned = await board.patch(task, "admin", Assignee=[board.user("member2")])
    assert reassigned.status_code == 200, reassigned.text

    # The old assignee cannot even open the task any more, and cannot add subtasks to it.
    assert_problem(await create_subtask(work, board, "member", task["id"], Name="B"), 403)


async def test_removing_a_department_head_removes_the_right(work: Work, board: Board) -> None:
    department = await make_head(work, "member")
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    cleared = await work.api(
        "PATCH", f"/departments/{department['id']}", json={"head_user_id": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert_problem(await create_subtask(work, board, "member", task["id"], Name="A"), 403)


async def test_a_head_of_another_organization_gets_nothing(work: Work, board: Board) -> None:
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    response = await create_subtask(work, board, "other_admin", task["id"], Name="Banner")
    assert_problem(response, 404)


async def test_a_hidden_column_still_blocks_the_head(work: Work, board: Board) -> None:
    """Column rules apply to the subtask like to any record: a hidden column is unknown."""
    await make_head(work, "member")
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    hidden = await work.api(
        "PUT",
        f"/fields/{board.f['Due date']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert hidden.status_code in (200, 204), hidden.text
    response = await create_subtask(work, board, "member", task["id"], **{"Due date": "2026-12-01"})
    assert_problem(response, 422)
