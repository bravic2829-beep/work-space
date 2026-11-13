import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.work_world import Work

MISSING = str(uuid.uuid4())


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    board = Board(work, await work.make_table(base_id, "Tasks", template="tasks"))
    board.f["Points"] = (await work.make_field(board.id, "Points", "number"))["id"]
    return board


def config(board: Board, **extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "filter": [{"field": board.f["Points"], "op": "gt", "value": 5}],
        "sort": [{"field": board.f["Points"], "direction": "desc"}],
        "hidden_fields": [board.f["Follower"]],
    }
    return {**base, **extra}


async def make(board: Board, name: str = "My view", who: str = "editor", **extra: Any) -> Any:
    return await board.work.api(
        "POST",
        f"/tables/{board.id}/views",
        who,
        json={"name": name, "config": config(board, **extra)},
    )


# --- own views -------------------------------------------------------------------------------


async def test_create_and_list_my_views(board: Board) -> None:
    response = await make(board)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "My view"
    assert body["table_id"] == board.id
    assert body["config"]["sort"] == [{"field": board.f["Points"], "direction": "desc"}]
    assert body["config"]["hidden_fields"] == [board.f["Follower"]]
    assert response.headers["location"] == f"/api/v1/views/{body['id']}"
    listed = await board.work.api("GET", f"/tables/{board.id}/views", "editor")
    assert [v["id"] for v in listed.json()] == [body["id"]]


async def test_a_view_can_be_empty(board: Board) -> None:
    response = await board.work.api(
        "POST", f"/tables/{board.id}/views", "viewer", json={"name": "Plain"}
    )
    assert response.status_code == 201
    assert response.json()["config"] == {"filter": [], "sort": [], "hidden_fields": []}


async def test_everybody_who_can_read_the_table_can_have_views(board: Board) -> None:
    for who in ("viewer", "commenter", "wsadmin", "admin"):
        assert (await make(board, who=who)).status_code == 201, who
    # An assignee who is not in the workspace can open the table, so can have a view too.
    await board.create(Name="Mine", Assignee=[board.user("member")])
    assert (await make(board, who="member", hidden_fields=[])).status_code == 201


async def test_views_are_private(board: Board) -> None:
    mine = (await make(board, who="editor")).json()
    url = f"/views/{mine['id']}"
    assert (await board.work.api("GET", f"/tables/{board.id}/views", "viewer")).json() == []
    for who in ("viewer", "commenter", "wsadmin", "admin"):
        assert_problem(await board.work.api("GET", url, who), 403)
        assert_problem(await board.work.api("PATCH", url, who, json={"name": "Taken"}), 403)
        assert_problem(await board.work.api("DELETE", url, who), 403)
    assert_problem(await board.work.api("GET", url, "other_admin"), 404)
    assert (await board.work.api("GET", url, "editor")).status_code == 200


async def test_two_people_can_use_the_same_view_name(board: Board) -> None:
    assert (await make(board, "Shared name", "editor")).status_code == 201
    assert (await make(board, "Shared name", "viewer")).status_code == 201


async def test_view_names_are_unique_per_person_and_table(board: Board) -> None:
    await make(board, "Open")
    assert_problem(await make(board, "open"), 409)
    other = await board.work.make_table(await board.work.make_base("Second"), "Other")
    again = await board.work.api(
        "POST", f"/tables/{other['id']}/views", "editor", json={"name": "Open"}
    )
    assert again.status_code == 201


async def test_a_person_has_a_limited_number_of_views(board: Board) -> None:
    for number in range(50):
        response = await board.work.api(
            "POST", f"/tables/{board.id}/views", "viewer", json={"name": f"v{number}"}
        )
        assert response.status_code == 201
    extra = await board.work.api(
        "POST", f"/tables/{board.id}/views", "viewer", json={"name": "one too many"}
    )
    assert_problem(extra, 409)


# --- the config is checked -------------------------------------------------------------------


async def test_a_view_cannot_name_unknown_fields_or_operators(board: Board) -> None:
    bad: list[dict[str, Any]] = [
        {"filter": [{"field": MISSING, "op": "eq", "value": 1}]},
        {"filter": [{"field": board.f["Points"], "op": "regex", "value": "x"}]},
        {"filter": [{"field": board.f["Points"], "op": "gt", "value": "lots"}]},
        {"sort": [{"field": MISSING, "direction": "asc"}]},
        {"sort": [{"field": board.f["Assignee"], "direction": "asc"}]},  # users have no order
        {"hidden_fields": [MISSING]},
        {"hidden_fields": ["not-an-id"]},
        {"filter": [{"field": board.f["Points"], "op": "gt", "value": 1, "sql": "1=1"}]},
        {"sort": [{"field": board.f["Points"], "direction": "sideways"}]},
        {"surprise": True},
        {"filter": [{"field": board.f["Points"], "op": "is_not_empty"}] * 21},
    ]
    for extra in bad:
        response = await board.work.api(
            "POST",
            f"/tables/{board.id}/views",
            "editor",
            json={"name": "Bad", "config": extra},
        )
        assert_problem(response, 422)


async def test_a_view_cannot_use_a_column_hidden_from_its_owner(board: Board) -> None:
    await board.work.api(
        "PUT",
        f"/fields/{board.f['Points']}/access/{board.user('viewer')}",
        json={"access": "hidden"},
    )
    assert_problem(await make(board, who="viewer"), 422)
    assert (await make(board, who="editor")).status_code == 201


async def test_view_input_is_validated(board: Board) -> None:
    url = f"/tables/{board.id}/views"
    for body in ({}, {"name": ""}, {"name": "x" * 101}, {"name": "ok", "owner_user_id": MISSING}):
        assert_problem(await board.work.api("POST", url, "editor", json=body), 422)
    assert_problem(await board.work.api("POST", url, "nobody", json={"name": "x"}), 401)
    assert_problem(await board.work.api("POST", url, "member", json={"name": "x"}), 403)
    assert_problem(await board.work.api("POST", url, "other_admin", json={"name": "x"}), 404)
    assert_problem(
        await board.work.api("POST", f"/tables/{MISSING}/views", "editor", json={"name": "x"}), 404
    )


# --- change and delete -----------------------------------------------------------------------


async def test_rename_and_change_a_view(board: Board) -> None:
    view = (await make(board)).json()
    url = f"/views/{view['id']}"
    renamed = await board.work.api("PATCH", url, "editor", json={"name": "Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed"
    assert renamed.json()["config"] == view["config"]
    changed = await board.work.api(
        "PATCH", url, "editor", json={"config": {"sort": [], "hidden_fields": []}}
    )
    assert changed.json()["config"] == {"filter": [], "sort": [], "hidden_fields": []}
    assert changed.json()["updated_at"] >= view["updated_at"]
    assert_problem(await board.work.api("PATCH", url, "editor", json={}), 422)
    assert_problem(await board.work.api("PATCH", url, "editor", json={"id": MISSING}), 422)
    assert_problem(
        await board.work.api("PATCH", url, "editor", json={"config": {"hidden_fields": [MISSING]}}),
        422,
    )
    await make(board, "Other")
    assert_problem(await board.work.api("PATCH", url, "editor", json={"name": "other"}), 409)


async def test_delete_a_view(board: Board) -> None:
    view = (await make(board)).json()
    url = f"/views/{view['id']}"
    assert (await board.work.api("DELETE", url, "editor")).status_code == 204
    assert_problem(await board.work.api("GET", url, "editor"), 404)
    assert_problem(await board.work.api("DELETE", url, "editor"), 404)
    assert (await board.work.api("GET", f"/tables/{board.id}/views", "editor")).json() == []
    assert_problem(await board.work.api("GET", f"/views/{MISSING}", "editor"), 404)


async def test_views_of_a_deleted_table_are_unreachable(board: Board) -> None:
    view = (await make(board)).json()
    await board.work.api("DELETE", f"/tables/{board.id}")
    assert_problem(await board.work.api("GET", f"/views/{view['id']}", "editor"), 404)


async def test_a_view_survives_its_column_being_deleted(board: Board) -> None:
    view = (await make(board)).json()
    await board.work.api("DELETE", f"/fields/{board.f['Points']}")
    # Reading it still works. The list endpoint would refuse a filter on the missing column,
    # which the client handles by dropping that part.
    assert (await board.work.api("GET", f"/views/{view['id']}", "editor")).status_code == 200
