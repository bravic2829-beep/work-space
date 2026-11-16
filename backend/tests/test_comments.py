"""Comments on records (usecases.md 3.2: an assigned person can comment but not edit)."""

import base64
import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem, db_fetch
from tests.test_records import Board
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def say(work: Work, record: dict[str, Any], who: str, body: Any = "Looks good") -> Any:
    return await work.api("POST", f"/records/{record['id']}/comments", who, json={"body": body})


async def read(work: Work, record: dict[str, Any], who: str, **params: Any) -> Any:
    return await work.api("GET", f"/records/{record['id']}/comments", who, params=params)


async def task(work: Work, board: Board) -> dict[str, Any]:
    return await board.create(Name="Launch", Assignee=[board.user("member")])


# --- who can comment --------------------------------------------------------------------------


async def test_an_assigned_person_outside_the_workspace_can_comment_but_not_edit(
    work: Work, board: Board
) -> None:
    record = await task(work, board)
    created = await say(work, record, "member", "  On it.  ")
    assert created.status_code == 201, created.text
    comment = created.json()
    assert comment["body"] == "On it."  # trimmed
    assert comment["author"] == {"id": board.user("member"), "full_name": "Test User"}
    assert created.headers["location"] == f"/api/v1/comments/{comment['id']}"

    assert_problem(await board.patch(record, "member", Name="Hijacked"), 403)


@pytest.mark.parametrize("who", ["admin", "wsadmin", "editor", "commenter"])
async def test_workspace_roles_from_commenter_up_can_comment(
    work: Work, board: Board, who: str
) -> None:
    record = await task(work, board)
    assert (await say(work, record, who)).status_code == 201


async def test_a_workspace_viewer_can_read_but_not_comment(work: Work, board: Board) -> None:
    record = await task(work, board)
    assert_problem(await say(work, record, "viewer"), 403)
    assert (await read(work, record, "viewer")).status_code == 200


async def test_somebody_who_cannot_see_the_record_cannot_read_or_write(
    work: Work, board: Board
) -> None:
    record = await task(work, board)
    await say(work, record, "member", "private thread")

    assert_problem(await say(work, record, "member2"), 403)
    assert_problem(await read(work, record, "member2"), 403)
    assert_problem(await say(work, record, "other_admin"), 404)
    assert_problem(await read(work, record, "other_admin"), 404)
    missing = {"id": str(uuid.uuid4())}
    assert_problem(await say(work, missing, "admin"), 404)
    assert_problem(await read(work, missing, "admin"), 404)


async def test_losing_the_assignment_ends_access_to_the_thread(work: Work, board: Board) -> None:
    record = await task(work, board)
    await say(work, record, "member", "mine")
    moved = await board.patch(record, "admin", Assignee=[board.user("member2")])
    assert moved.status_code == 200
    assert_problem(await read(work, record, "member"), 403)
    assert_problem(await say(work, record, "member"), 403)
    assert (await read(work, record, "member2")).status_code == 200


async def test_the_login_is_required(work: Work, board: Board) -> None:
    record = await task(work, board)
    url = f"/api/v1/records/{record['id']}/comments"
    assert_problem(await work.client.get(url), 401)
    assert_problem(await work.client.post(url, json={"body": "hi"}), 401)
    assert_problem(await work.client.delete(f"/api/v1/comments/{uuid.uuid4()}"), 401)


# --- bad input --------------------------------------------------------------------------------


@pytest.mark.parametrize("body", ["", "   ", "x" * 5001, None, 5, ["a"]])
async def test_a_bad_body_is_refused(work: Work, board: Board, body: Any) -> None:
    record = await task(work, board)
    assert_problem(await say(work, record, "member", body), 422)
    assert (await read(work, record, "member")).json()["items"] == []


async def test_a_comment_with_a_nul_character_is_a_422_not_a_500(work: Work, board: Board) -> None:
    record = await task(work, board)
    assert_problem(await say(work, record, "member", "bad\x00comment"), 422)


async def test_the_largest_comment_is_accepted_and_extra_fields_are_not(
    work: Work, board: Board
) -> None:
    record = await task(work, board)
    assert (await say(work, record, "member", "x" * 5000)).status_code == 201
    response = await work.api(
        "POST",
        f"/records/{record['id']}/comments",
        "member",
        json={"body": "ok", "author_id": board.user("admin")},
    )
    assert_problem(response, 422)


# --- reading and deleting ---------------------------------------------------------------------


async def test_comments_are_listed_oldest_first_and_paged(work: Work, board: Board) -> None:
    record = await task(work, board)
    for index in range(5):
        assert (await say(work, record, "member", f"c{index}")).status_code == 201

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = (await read(work, record, "admin", **params)).json()
        seen += [c["body"] for c in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == ["c0", "c1", "c2", "c3", "c4"]


@pytest.mark.parametrize("limit", [0, 101])
async def test_the_limit_is_checked(work: Work, board: Board, limit: int) -> None:
    record = await task(work, board)
    assert_problem(await read(work, record, "admin", limit=limit), 422)


@pytest.mark.parametrize(
    "cursor",
    ["garbage", base64.urlsafe_b64encode(b"2026-01-01T00:00:00|x").decode()],
)
async def test_a_forged_cursor_is_refused(work: Work, board: Board, cursor: str) -> None:
    record = await task(work, board)
    assert_problem(await read(work, record, "admin", cursor=cursor), 422)


async def test_only_the_author_deletes_a_comment(work: Work, board: Board) -> None:
    record = await task(work, board)
    comment = (await say(work, record, "member", "mine")).json()
    url = f"/comments/{comment['id']}"

    # The creator of the task and a workspace admin cannot remove somebody else's words.
    for who in ("wsadmin", "editor"):
        assert_problem(await work.api("DELETE", url, who), 403)
    # Somebody who cannot see the record does not learn that the comment exists.
    assert_problem(await work.api("DELETE", url, "member2"), 404)
    assert_problem(await work.api("DELETE", url, "other_admin"), 404)
    assert len((await read(work, record, "admin")).json()["items"]) == 1

    assert (await work.api("DELETE", url, "member")).status_code == 204
    assert (await read(work, record, "admin")).json()["items"] == []
    assert_problem(await work.api("DELETE", url, "member"), 404)


async def test_the_organization_admin_deletes_any_comment(work: Work, board: Board) -> None:
    record = await task(work, board)
    comment = (await say(work, record, "member", "not okay")).json()
    assert (await work.api("DELETE", f"/comments/{comment['id']}", "admin")).status_code == 204
    assert (await read(work, record, "admin")).json()["items"] == []


async def test_comments_of_a_record_in_the_trash_are_not_reachable(
    work: Work, board: Board
) -> None:
    record = await task(work, board)
    comment = (await say(work, record, "member")).json()
    assert (await work.api("DELETE", f"/records/{record['id']}", "admin")).status_code == 204
    assert_problem(await read(work, record, "admin"), 404)
    assert_problem(await work.api("DELETE", f"/comments/{comment['id']}", "member"), 404)


async def test_deleting_a_record_removes_its_comments_and_notifications_for_good(
    work: Work, board: Board, migrated_database_url: str
) -> None:
    record = await task(work, board)  # the assignee is told about it
    assert (await say(work, record, "member", "On it")).status_code == 201
    record_id = uuid.UUID(record["id"])
    for table in ("comments", "notifications", "records"):
        key = "id" if table == "records" else "record_id"
        rows = await db_fetch(
            migrated_database_url, f"SELECT 1 FROM {table} WHERE {key} = $1", record_id
        )
        assert len(rows) == 1, table

    assert (await work.api("DELETE", f"/records/{record['id']}", "admin")).status_code == 204

    # Nothing is left behind, not even marked: there is no trash step.
    for table in ("comments", "notifications", "records"):
        key = "id" if table == "records" else "record_id"
        rows = await db_fetch(
            migrated_database_url, f"SELECT 1 FROM {table} WHERE {key} = $1", record_id
        )
        assert rows == [], table
