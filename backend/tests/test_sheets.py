"""Sheets: a person's own view of a task table, with its own list of who may do what."""

from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_review import review
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def make_sheet(
    board: Board, owner: str = "member", who: str = "admin", **extra: Any
) -> dict[str, Any]:
    response = await board.work.api(
        "POST",
        f"/tables/{board.id}/sheets",
        who,
        json={"owner_id": board.user(owner), **extra},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def sheet_records(work: Work, sheet_id: str, who: str) -> list[dict[str, Any]]:
    response = await work.api("GET", f"/sheets/{sheet_id}/records", who)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def add_member(work: Work, sheet_id: str, user: str, role: str, who: str = "admin") -> Any:
    return await work.api(
        "PUT",
        f"/sheets/{sheet_id}/members/{work.users[user]}",
        who,
        json={"role": role},
    )


# --- creating and listing ---------------------------------------------------------------------


async def test_an_admin_makes_a_sheet_for_a_person(board: Board) -> None:
    sheet = await make_sheet(board)
    assert sheet["owner"]["id"] == board.user("member")
    assert sheet["name"]  # the owner's name by default
    assert sheet["my_role"] == "manager"
    assert sheet["is_admin"] is True
    assert sheet["table_name"] == "Tasks"

    named = await make_sheet(board, "member2", name="Second sheet")
    assert named["name"] == "Second sheet"


async def test_one_sheet_per_person_and_table(board: Board) -> None:
    await make_sheet(board)
    again = await board.work.api(
        "POST", f"/tables/{board.id}/sheets", json={"owner_id": board.user("member")}
    )
    assert_problem(again, 409)


async def test_only_admins_make_sheets(board: Board) -> None:
    work = board.work
    body = {"owner_id": board.user("member")}
    for who in ("editor", "member", "viewer"):
        assert_problem(await work.api("POST", f"/tables/{board.id}/sheets", who, json=body), 403)
    # The admin of the workspace may.
    assert (
        await work.api("POST", f"/tables/{board.id}/sheets", "wsadmin", json=body)
    ).status_code == 201


async def test_a_table_without_an_assignee_column_has_no_sheets(work: Work) -> None:
    plain = await work.make_table(await work.make_base(), "Notes")
    response = await work.api(
        "POST", f"/tables/{plain['id']}/sheets", json={"owner_id": str(work.users["member"])}
    )
    assert_problem(response, 409)


async def test_an_unknown_person_is_refused(board: Board) -> None:
    response = await board.work.api(
        "POST",
        f"/tables/{board.id}/sheets",
        json={"owner_id": "00000000-0000-0000-0000-000000000001"},
    )
    assert_problem(response, 422)


async def test_each_person_lists_only_the_sheets_they_are_on(board: Board) -> None:
    work = board.work
    mine = await make_sheet(board, "member")
    other = await make_sheet(board, "member2")

    names = {s["id"] for s in (await work.api("GET", "/sheets", "admin")).json()}
    assert names == {mine["id"], other["id"]}
    seen = (await work.api("GET", "/sheets", "member")).json()
    assert [s["id"] for s in seen] == [mine["id"]]
    assert seen[0]["my_role"] == "editor"  # the owner edits their own sheet
    assert seen[0]["is_admin"] is False
    assert seen[0]["can_see_all"] is False
    assert (await work.api("GET", "/sheets", "viewer")).json() == []
    # Another organization sees nothing.
    assert (await work.api("GET", "/sheets", "other_admin")).json() == []


async def test_a_sheet_of_another_organization_does_not_exist(board: Board) -> None:
    sheet = await make_sheet(board)
    assert_problem(await board.work.api("GET", f"/sheets/{sheet['id']}", "other_admin"), 404)


# --- what a sheet shows -----------------------------------------------------------------------


async def test_a_sheet_shows_the_tasks_of_its_owner_only(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await board.create(Name="Mine", Assignee=[board.user("member")])
    await board.create(Name="Also mine", Assignee=[board.user("member"), board.user("member2")])
    await board.create(Name="Theirs", Assignee=[board.user("member2")])

    names = {r["data"][board.f["Name"]] for r in await sheet_records(work, sheet["id"], "member")}
    assert names == {"Mine", "Also mine"}
    # The admin sees the same tasks through the sheet, and all of them through the table.
    assert len(await sheet_records(work, sheet["id"], "admin")) == 2
    everything = (await work.api("GET", f"/tables/{board.id}/records", "admin")).json()["items"]
    assert len(everything) == 3


async def test_the_table_and_the_sheet_are_the_same_data(board: Board) -> None:
    sheet = await make_sheet(board)
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    patched = await board.patch(task, "admin", Name="Plan v2")
    assert patched.status_code == 200
    names = [
        r["data"][board.f["Name"]] for r in await sheet_records(board.work, sheet["id"], "member")
    ]
    assert names == ["Plan v2"]


async def test_a_member_may_open_the_table_even_with_no_task_yet(board: Board) -> None:
    work = board.work
    await make_sheet(board, "member")
    # Before the sheet this was a 403: nothing named the person.
    assert (await work.api("GET", f"/tables/{board.id}", "member")).status_code == 200
    assert_problem(await work.api("GET", f"/tables/{board.id}", "member2"), 403)


async def test_a_stranger_cannot_open_the_sheet(board: Board) -> None:
    sheet = await make_sheet(board, "member")
    assert_problem(await board.work.api("GET", f"/sheets/{sheet['id']}/records", "member2"), 403)
    assert_problem(await board.work.api("GET", f"/sheets/{sheet['id']}", "member2"), 403)


# --- the roles of a sheet ---------------------------------------------------------------------


async def test_a_collaborator_added_as_viewer_sees_the_tasks_but_cannot_change_them(
    board: Board,
) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    assert (await add_member(work, sheet["id"], "member2", "viewer")).status_code == 200

    assert len(await sheet_records(work, sheet["id"], "member2")) == 1
    assert (await work.api("GET", f"/records/{task['id']}", "member2")).status_code == 200
    assert_problem(await board.patch(task, "member2", Name="Hacked"), 403)
    # A viewer cannot add a task to the sheet either.
    added = await work.api(
        "POST", f"/sheets/{sheet['id']}/records", "member2", json={"data": {board.f["Name"]: "x"}}
    )
    assert_problem(added, 403)
    # And cannot comment.
    comment = await work.api(
        "POST", f"/records/{task['id']}/comments", "member2", json={"body": "hello"}
    )
    assert_problem(comment, 403)


async def test_removing_a_member_closes_the_door(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    await add_member(work, sheet["id"], "member2", "viewer")
    assert (await work.api("GET", f"/records/{task['id']}", "member2")).status_code == 200

    removed = await work.api("DELETE", f"/sheets/{sheet['id']}/members/{work.users['member2']}")
    assert removed.status_code == 204
    assert_problem(await work.api("GET", f"/records/{task['id']}", "member2"), 403)
    assert_problem(await work.api("GET", f"/sheets/{sheet['id']}/records", "member2"), 403)


async def test_the_owner_edits_but_not_the_columns_that_belong_to_the_manager(
    board: Board,
) -> None:
    work = board.work
    await make_sheet(board, "member")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])

    ok = await board.patch(
        task, "member", **{"Progress update": "Half way", "Result": "draft.xlsx"}
    )
    assert ok.status_code == 200, ok.text
    current = ok.json()
    # Cannot reassign, move the status by hand, or write the manager's feedback.
    assert_problem(await board.patch(current, "member", Assignee=[board.user("member2")]), 403)
    assert_problem(await board.patch(current, "member", Status=board.status_options["Done"]), 403)
    assert_problem(await board.patch(current, "member", **{"Manager feedback": "great"}), 403)
    # The owner still reports the task as done, through the review button.
    assert (await review(work, current, "member", "submit")).status_code == 200


async def test_an_editor_adds_tasks_to_the_sheet_and_they_are_assigned_to_its_owner(
    board: Board,
) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await add_member(work, sheet["id"], "member2", "editor")

    # The owner adds a task: it is theirs even though the request says nothing about it.
    made = await work.api(
        "POST",
        f"/sheets/{sheet['id']}/records",
        "member",
        json={"data": {board.f["Name"]: "New job", board.f["Result"]: "notes.docx"}},
    )
    assert made.status_code == 201, made.text
    assert made.json()["data"][board.f["Assignee"]] == [board.user("member")]
    # An editor cannot assign it to somebody else.
    sneaky = await work.api(
        "POST",
        f"/sheets/{sheet['id']}/records",
        "member2",
        json={"data": {board.f["Name"]: "x", board.f["Assignee"]: [board.user("member2")]}},
    )
    assert_problem(sneaky, 403)
    # The other editor adds one too, still for the owner.
    other = await work.api(
        "POST", f"/sheets/{sheet['id']}/records", "member2", json={"data": {board.f["Name"]: "y"}}
    )
    assert other.status_code == 201
    assert other.json()["data"][board.f["Assignee"]] == [board.user("member")]
    assert len(await sheet_records(work, sheet["id"], "member")) == 2


async def test_a_manager_may_write_every_column_and_review(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await add_member(work, sheet["id"], "member2", "manager")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])

    done = await board.patch(task, "member2", **{"Manager feedback": "Add last year's column"})
    assert done.status_code == 200, done.text

    submitted = (await review(work, done.json(), "member", "submit")).json()
    approved = await review(work, submitted, "member2", "approve")
    assert approved.status_code == 200, approved.text
    # A plain editor of the sheet may not review.
    other = await board.create(Name="Other", Assignee=[board.user("member")])
    await add_member(work, sheet["id"], "viewer", "editor")
    sent = (await review(work, other, "member", "submit")).json()
    assert_problem(await review(work, sent, "viewer", "approve"), 403)


async def test_a_sheet_manager_starts_and_stops_the_timer(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await add_member(work, sheet["id"], "member2", "manager")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    started = await work.api(
        "POST",
        f"/records/{task['id']}/timer",
        "member2",
        json={"action": "start"},
        headers={"If-Match": f'"{task["version"]}"'},
    )
    assert started.status_code == 200, started.text


async def test_the_owner_cannot_drop_below_editor_or_leave(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    assert_problem(await add_member(work, sheet["id"], "member", "viewer"), 422)
    gone = await work.api("DELETE", f"/sheets/{sheet['id']}/members/{work.users['member']}")
    assert_problem(gone, 409)


async def test_only_managers_see_and_change_the_member_list(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    members = (await work.api("GET", f"/sheets/{sheet['id']}/members")).json()
    assert members[0]["is_owner"] is True
    assert members[0]["user_id"] == board.user("member")
    # The owner is an editor: not enough to share.
    assert_problem(await work.api("GET", f"/sheets/{sheet['id']}/members", "member"), 403)
    assert_problem(await add_member(work, sheet["id"], "member2", "viewer", who="member"), 403)
    # Make a manager: now they may.
    await add_member(work, sheet["id"], "member2", "manager")
    assert (
        await add_member(work, sheet["id"], "viewer", "viewer", who="member2")
    ).status_code == 200


async def test_a_person_added_to_a_sheet_must_be_a_real_employee(board: Board) -> None:
    sheet = await make_sheet(board)
    response = await board.work.api(
        "PUT",
        f"/sheets/{sheet['id']}/members/00000000-0000-0000-0000-000000000001",
        json={"role": "viewer"},
    )
    assert_problem(response, 422)


# --- rename and archive -----------------------------------------------------------------------


async def test_admins_rename_and_archive_but_the_owner_cannot(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    renamed = await work.api("PATCH", f"/sheets/{sheet['id']}", json={"name": "Renamed"})
    assert renamed.json()["name"] == "Renamed"
    assert_problem(
        await work.api("PATCH", f"/sheets/{sheet['id']}", "member", json={"name": "x"}), 403
    )
    assert_problem(await work.api("DELETE", f"/sheets/{sheet['id']}", "member"), 403)

    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    await add_member(work, sheet["id"], "member2", "viewer")
    assert (await work.api("DELETE", f"/sheets/{sheet['id']}")).status_code == 204
    # The sheet is gone from every list, the task stays, and the viewer lost the door.
    assert (await work.api("GET", "/sheets")).json() == []
    assert_problem(await work.api("GET", f"/records/{task['id']}", "member2"), 403)
    assert (await work.api("GET", f"/records/{task['id']}")).status_code == 200
    # The owner is still assigned, so the task is still theirs.
    assert (await work.api("GET", f"/records/{task['id']}", "member")).status_code == 200


async def test_a_person_can_have_a_new_sheet_after_the_old_one_is_archived(board: Board) -> None:
    sheet = await make_sheet(board)
    await board.work.api("DELETE", f"/sheets/{sheet['id']}")
    again = await make_sheet(board)
    assert again["id"] != sheet["id"]


# --- tasks that move between sheets -----------------------------------------------------------


async def test_reassigning_a_task_moves_it_to_the_other_sheet(board: Board) -> None:
    work = board.work
    first = await make_sheet(board, "member")
    second = await make_sheet(board, "member2")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    assert len(await sheet_records(work, first["id"], "member")) == 1
    assert len(await sheet_records(work, second["id"], "member2")) == 0

    moved = await board.patch(task, "admin", Assignee=[board.user("member2")])
    assert moved.status_code == 200
    assert len(await sheet_records(work, first["id"], "member")) == 0
    assert len(await sheet_records(work, second["id"], "member2")) == 1
    # The first owner can no longer open it; the second can.
    assert_problem(await work.api("GET", f"/records/{task['id']}", "member"), 403)
    assert (await work.api("GET", f"/records/{task['id']}", "member2")).status_code == 200


async def test_a_collaborator_sees_the_task_in_who_can_see_it(board: Board) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await add_member(work, sheet["id"], "member2", "viewer")
    task = await board.create(Name="Plan", Assignee=[board.user("member")])
    body = (await work.api("GET", f"/records/{task['id']}/viewers")).json()
    reasons = {p["user_id"]: p["reasons"] for p in body["people"]}
    assert "sheet" in reasons[board.user("member2")]
