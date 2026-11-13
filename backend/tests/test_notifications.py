"""Notifications when a task is assigned (usecases.md 4.7, UC-K1, UC-K7, UC-N2, UC-N3, UC-N4)."""

import base64
import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem, login_as
from tests.test_records import Board
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def inbox(work: Work, who: str, **params: Any) -> list[dict[str, Any]]:
    response = await work.api("GET", "/notifications", who, params=params)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def unread(work: Work, who: str) -> int:
    response = await work.api("GET", "/notifications/unread-count", who)
    assert response.status_code == 200, response.text
    return int(response.json()["unread"])


# --- who gets one -----------------------------------------------------------------------------


async def test_the_new_assignee_is_notified_even_outside_the_workspace(
    work: Work, board: Board
) -> None:
    task = await board.create("editor", Name="Launch", Assignee=[board.user("member")])

    items = await inbox(work, "member")
    assert len(items) == 1
    note = items[0]
    assert note["type"] == "task_assigned"
    assert note["record_id"] == task["id"]
    assert note["table_id"] == board.id
    assert note["record_name"] == "Launch"
    assert note["actor"] == {"id": board.user("editor"), "full_name": "Test User"}
    assert note["read_at"] is None
    assert await unread(work, "member") == 1


async def test_assigning_yourself_notifies_nobody(work: Work, board: Board) -> None:
    await board.create("editor", Name="Mine", Assignee=[board.user("editor")])
    assert await inbox(work, "editor") == []
    assert await unread(work, "editor") == 0


async def test_only_the_people_who_are_new_get_one(work: Work, board: Board) -> None:
    task = await board.create(Name="Launch", Assignee=[board.user("member"), board.user("editor")])
    assert len(await inbox(work, "member")) == 1
    assert len(await inbox(work, "editor")) == 1

    # Saving the same people again, or another column, notifies nobody.
    same = await board.patch(
        task, "admin", Assignee=[board.user("member"), board.user("editor")], Name="Launch 2"
    )
    assert same.status_code == 200, same.text
    assert len(await inbox(work, "member")) == 1

    # Adding a person notifies that person only.
    added = await board.patch(
        same.json(),
        "admin",
        Assignee=[board.user("member"), board.user("editor"), board.user("member2")],
    )
    assert added.status_code == 200, added.text
    assert len(await inbox(work, "member2")) == 1
    assert len(await inbox(work, "member")) == 1


async def test_reassigning_notifies_the_new_person_and_not_the_old_one(
    work: Work, board: Board
) -> None:
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    moved = await board.patch(task, "admin", Assignee=[board.user("member2")])
    assert moved.status_code == 200, moved.text

    assert len(await inbox(work, "member2")) == 1
    assert len(await inbox(work, "member")) == 1  # only the first one, nothing new


async def test_a_task_without_assignees_notifies_nobody(work: Work, board: Board) -> None:
    await board.create(Name="Unassigned")
    for who in ("member", "editor", "admin"):
        assert await inbox(work, who) == []


async def test_a_rejected_request_leaves_no_notification(work: Work, board: Board) -> None:
    response = await work.api(
        "POST",
        f"/tables/{board.id}/records",
        "admin",
        json={
            "data": {
                board.f["Assignee"]: [board.user("member")],
                board.f["Due date"]: "not a date",
            }
        },
    )
    assert response.status_code == 422
    assert await inbox(work, "member") == []


# --- who sees what ----------------------------------------------------------------------------


async def test_nobody_reads_the_notifications_of_somebody_else(work: Work, board: Board) -> None:
    await board.create(Name="Launch", Assignee=[board.user("member")])
    note = (await inbox(work, "member"))[0]

    assert await inbox(work, "member2") == []
    assert await inbox(work, "admin") == []
    assert await unread(work, "member2") == 0

    for who in ("member2", "admin", "other_admin"):
        response = await work.api("PATCH", f"/notifications/{note['id']}", who, json={"read": True})
        assert_problem(response, 404)
    assert await unread(work, "member") == 1  # nobody else could mark it read


async def test_the_inbox_needs_a_login(work: Work) -> None:
    for method, url in (
        ("GET", "/notifications"),
        ("GET", "/notifications/unread-count"),
        ("POST", "/notifications/read-all"),
        ("PATCH", f"/notifications/{uuid.uuid4()}"),
    ):
        response = await work.client.request(method, f"/api/v1{url}", json={"read": True})
        assert_problem(response, 401)


async def test_a_hidden_task_name_does_not_leak_into_the_notification(
    work: Work, board: Board
) -> None:
    hidden = await work.api(
        "PUT",
        f"/fields/{board.f['Name']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert hidden.status_code == 200, hidden.text

    await board.create(Name="Secret plan", Assignee=[board.user("member")])
    await board.create(Name="Open plan", Assignee=[board.user("member2")])

    assert (await inbox(work, "member"))[0]["record_name"] is None
    assert (await inbox(work, "member2"))[0]["record_name"] == "Open plan"


async def test_a_task_in_the_trash_leaves_the_inbox(work: Work, board: Board) -> None:
    task = await board.create(Name="Launch", Assignee=[board.user("member")])
    other = await board.create(Name="Keep", Assignee=[board.user("member")])
    assert await unread(work, "member") == 2

    assert (await work.api("DELETE", f"/records/{task['id']}", "admin")).status_code == 204

    assert [n["record_id"] for n in await inbox(work, "member")] == [other["id"]]
    assert await unread(work, "member") == 1


# --- reading ----------------------------------------------------------------------------------


async def test_marking_read_and_unread(work: Work, board: Board) -> None:
    await board.create(Name="One", Assignee=[board.user("member")])
    await board.create(Name="Two", Assignee=[board.user("member")])
    first, second = await inbox(work, "member")  # newest first
    assert (first["record_name"], second["record_name"]) == ("Two", "One")

    read = await work.api("PATCH", f"/notifications/{first['id']}", "member", json={"read": True})
    assert read.status_code == 200, read.text
    stamp = read.json()["read_at"]
    assert stamp is not None
    assert await unread(work, "member") == 1
    assert [n["id"] for n in await inbox(work, "member", unread_only=True)] == [second["id"]]

    # Reading twice keeps the first time.
    again = await work.api("PATCH", f"/notifications/{first['id']}", "member", json={"read": True})
    assert again.json()["read_at"] == stamp

    back = await work.api("PATCH", f"/notifications/{first['id']}", "member", json={"read": False})
    assert back.json()["read_at"] is None
    assert await unread(work, "member") == 2


async def test_marking_everything_read_touches_only_my_notifications(
    work: Work, board: Board
) -> None:
    await board.create(Name="One", Assignee=[board.user("member")])
    await board.create(Name="Two", Assignee=[board.user("member")])
    await board.create(Name="Three", Assignee=[board.user("member2")])
    assert await unread(work, "member") == 2

    response = await work.api("POST", "/notifications/read-all", "member")
    assert response.status_code == 200, response.text
    assert response.json() == {"unread": 0}
    assert await unread(work, "member") == 0
    assert await inbox(work, "member", unread_only=True) == []
    assert len(await inbox(work, "member")) == 2  # still listed, only read
    assert await unread(work, "member2") == 1  # somebody else's stays unread

    # Nothing to mark is fine, and a person with no notifications gets zero.
    again = await work.api("POST", "/notifications/read-all", "member")
    assert again.json() == {"unread": 0}
    assert (await work.api("POST", "/notifications/read-all", "admin")).json() == {"unread": 0}


async def test_notifications_missed_while_offline_are_still_there_after_login(
    work: Work, board: Board
) -> None:
    await board.create(Name="While away", Assignee=[board.user("member")])
    # A new login (a fresh session) still sees it: it lives in the database, not in the browser.
    fresh = await login_as(work.client, "MEMBER")
    work.client.cookies.clear()
    response = await work.client.get("/api/v1/notifications", headers=fresh)
    assert [n["record_name"] for n in response.json()["items"]] == ["While away"]


async def test_the_list_is_paged_without_gaps_or_repeats(work: Work, board: Board) -> None:
    ids = [
        (await board.create(Name=f"T{i}", Assignee=[board.user("member")]))["id"] for i in range(5)
    ]
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        response = await work.api("GET", "/notifications", "member", params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        seen += [n["record_id"] for n in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert seen == list(reversed(ids))


@pytest.mark.parametrize("limit", [0, -1, 101])
async def test_the_limit_is_checked(work: Work, limit: int) -> None:
    response = await work.api("GET", "/notifications", "member", params={"limit": limit})
    assert_problem(response, 422)


@pytest.mark.parametrize(
    "cursor",
    [
        "garbage",
        base64.urlsafe_b64encode(b"nope").decode(),
        base64.urlsafe_b64encode(b"2026-01-01T00:00:00+00:00|not-a-uuid").decode(),
        base64.urlsafe_b64encode(f"2026-01-01T00:00:00|{uuid.uuid4()}".encode()).decode(),
        base64.urlsafe_b64encode(f"yesterday|{uuid.uuid4()}".encode()).decode(),
    ],
)
async def test_a_forged_cursor_is_refused(work: Work, cursor: str) -> None:
    response = await work.api("GET", "/notifications", "member", params={"cursor": cursor})
    assert_problem(response, 422)


async def test_the_update_body_is_strict(work: Work, board: Board) -> None:
    await board.create(Name="Launch", Assignee=[board.user("member")])
    note = (await inbox(work, "member"))[0]
    url = f"/notifications/{note['id']}"

    assert_problem(await work.api("PATCH", url, "member", json={"read": True, "type": "x"}), 422)
    assert_problem(await work.api("PATCH", url, "member", json={}), 422)
    missing = f"/notifications/{uuid.uuid4()}"
    assert_problem(await work.api("PATCH", missing, "member", json={"read": True}), 404)
