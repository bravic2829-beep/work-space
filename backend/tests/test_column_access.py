"""Choosing, for one person, which columns of a table they see: hidden, read only, or as usual."""

import json
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_sheets import make_sheet
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def set_rules(board: Board, who: str, rules: dict[str, str | None], by: str = "admin") -> Any:
    return await board.work.api(
        "PUT",
        f"/tables/{board.id}/field-access/{board.user(who)}",
        by,
        json={"fields": {board.f[name]: level for name, level in rules.items()}},
    )


async def columns_seen(board: Board, who: str) -> dict[str, str]:
    detail = (await board.work.api("GET", f"/tables/{board.id}", who)).json()
    return {f["name"]: f["access"] for f in detail["fields"]}


async def test_one_request_hides_and_narrows_several_columns_for_one_person(board: Board) -> None:
    done = await set_rules(
        board,
        "editor",
        {"Result": "hidden", "Manager feedback": "hidden", "Progress update": "read"},
    )
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["user_id"] == board.user("editor")
    assert {r["field_id"]: r["access"] for r in body["rules"]} == {
        board.f["Result"]: "hidden",
        board.f["Manager feedback"]: "hidden",
        board.f["Progress update"]: "read",
    }

    seen = await columns_seen(board, "editor")
    assert "Result" not in seen and "Manager feedback" not in seen
    assert seen["Progress update"] == "read"
    assert seen["Name"] == "edit"  # everything else as the role gives
    # Nobody else is touched.
    other = await columns_seen(board, "commenter")
    assert "Result" in other and "Manager feedback" in other
    assert "Result" in await columns_seen(board, "admin")


async def test_the_hidden_columns_are_missing_from_the_records_and_cannot_be_asked_for(
    board: Board,
) -> None:
    work = board.work
    await board.create(Name="Plan", Result="secret result", **{"Progress update": "fine"})
    await set_rules(board, "editor", {"Result": "hidden"})

    item = (await work.api("GET", f"/tables/{board.id}/records", "editor")).json()["items"][0]
    assert board.f["Result"] not in item["data"]
    assert item["data"][board.f["Progress update"]] == "fine"
    # They cannot even filter or sort by what they do not see.
    flt = json.dumps([{"field": board.f["Result"], "op": "contains", "value": "secret"}])
    assert_problem(
        await work.api("GET", f"/tables/{board.id}/records", "editor", params={"filter": flt}), 422
    )
    assert_problem(
        await work.api(
            "GET", f"/tables/{board.id}/records", "editor", params={"sort": board.f["Result"]}
        ),
        422,
    )
    # And cannot write it.
    record = (await work.api("GET", f"/tables/{board.id}/records")).json()["items"][0]
    assert_problem(await board.patch(record, "editor", Result="x"), 422)


async def test_null_puts_a_column_back_to_the_default_and_unnamed_columns_stay(
    board: Board,
) -> None:
    await set_rules(board, "editor", {"Result": "hidden", "Manager feedback": "read"})
    back = await set_rules(board, "editor", {"Result": None})
    assert back.status_code == 200
    assert [r["field_id"] for r in back.json()["rules"]] == [board.f["Manager feedback"]]
    seen = await columns_seen(board, "editor")
    assert seen["Result"] == "edit"
    assert seen["Manager feedback"] == "read"


async def test_the_overview_lists_who_has_rules(board: Board) -> None:
    await set_rules(board, "editor", {"Result": "hidden"})
    await set_rules(board, "viewer", {"Progress update": "hidden", "Result": "hidden"})
    everybody = (await board.work.api("GET", f"/tables/{board.id}/field-access")).json()
    counts = {p["user_id"]: len(p["rules"]) for p in everybody}
    assert counts == {board.user("editor"): 1, board.user("viewer"): 2}
    one = (
        await board.work.api("GET", f"/tables/{board.id}/field-access/{board.user('viewer')}")
    ).json()
    assert len(one["rules"]) == 2
    nothing = (
        await board.work.api("GET", f"/tables/{board.id}/field-access/{board.user('commenter')}")
    ).json()
    assert nothing["rules"] == []


async def test_it_is_all_or_nothing(board: Board) -> None:
    response = await board.work.api(
        "PUT",
        f"/tables/{board.id}/field-access/{board.user('editor')}",
        json={
            "fields": {board.f["Result"]: "hidden", "00000000-0000-0000-0000-000000000001": "read"}
        },
    )
    assert_problem(response, 422)
    assert "Result" in await columns_seen(board, "editor")  # the good half was not kept


async def test_the_person_must_be_a_real_active_employee(board: Board) -> None:
    response = await board.work.api(
        "PUT",
        f"/tables/{board.id}/field-access/00000000-0000-0000-0000-000000000001",
        json={"fields": {board.f["Result"]: "hidden"}},
    )
    assert_problem(response, 422)


async def test_only_admins_of_the_workspace_may_choose_what_others_see(board: Board) -> None:
    for who in ("editor", "commenter", "viewer", "member"):
        assert_problem(await set_rules(board, "viewer", {"Result": "hidden"}, by=who), 403)
        assert_problem(await board.work.api("GET", f"/tables/{board.id}/field-access", who), 403)
    # The workspace admin may; another company never.
    assert (await set_rules(board, "viewer", {"Result": "hidden"}, by="wsadmin")).status_code == 200
    assert_problem(await set_rules(board, "viewer", {"Result": "hidden"}, by="other_admin"), 404)


async def test_an_admin_is_never_restricted_by_a_rule(board: Board) -> None:
    await set_rules(board, "wsadmin", {"Result": "hidden"})
    seen = await columns_seen(board, "wsadmin")
    assert "Result" not in seen  # a workspace admin is an ordinary member for column rules
    # The organization admin, though, always sees and edits everything.
    await set_rules(board, "admin", {"Result": "hidden"})
    assert (await columns_seen(board, "admin"))["Result"] == "edit"


async def test_a_person_outside_the_workspace_with_a_sheet_gets_the_same_rules(
    board: Board,
) -> None:
    work = board.work
    sheet = await make_sheet(board, "member")
    await board.create(Name="Mine", Result="secret", Assignee=[board.user("member")])
    await set_rules(board, "member", {"Result": "hidden"})
    records = (await work.api("GET", f"/sheets/{sheet['id']}/records", "member")).json()["items"]
    assert board.f["Result"] not in records[0]["data"]
    assert (await work.api("GET", f"/sheets/{sheet['id']}/records")).json()["items"][0]["data"][
        board.f["Result"]
    ] == "secret"
