"""Realtime notifications over the WebSocket (UC-N1, UC-N4, UC-N5)."""

import pytest

from app.modules.notifications import ws
from app.modules.notifications.realtime import hub
from tests.api_helpers import login_as
from tests.helpers import ALLOWED_ORIGIN
from tests.test_records import Board
from tests.work_world import Work
from tests.ws_helpers import Socket


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


def sock(work: Work, who: str, **kwargs: object) -> Socket:
    return Socket(work.client, cookie=work.h[who], **kwargs)  # type: ignore[arg-type]


CHANGED = {"type": "notifications.changed"}


# --- the signal -------------------------------------------------------------------------------


async def test_a_new_assignment_is_announced_and_then_readable(work: Work, board: Board) -> None:
    async with sock(work, "member") as member:
        assert member.opened
        assert await member.receive() == {"type": "ready"}
        assert hub.count(work.users["member"]) == 1

        await board.create(Name="Launch", Assignee=[board.user("member")])

        assert await member.receive() == CHANGED
        # The signal carries no data: the browser asks the API, which checks permissions.
        listed = (await work.api("GET", "/notifications", "member")).json()["items"]
        assert [n["record_name"] for n in listed] == ["Launch"]
    assert hub.count(work.users["member"]) == 0


async def test_only_the_person_concerned_is_told(work: Work, board: Board) -> None:
    async with sock(work, "member") as member, sock(work, "member2") as other:
        await member.receive()
        await other.receive()
        await board.create(Name="Launch", Assignee=[board.user("member")])
        assert await member.receive() == CHANGED
        assert await other.is_quiet()


async def test_every_open_tab_of_the_person_is_told(work: Work, board: Board) -> None:
    async with sock(work, "member") as first, sock(work, "member") as second:
        await first.receive()
        await second.receive()
        assert hub.count(work.users["member"]) == 2
        await board.create(Name="Launch", Assignee=[board.user("member")])
        assert await first.receive() == CHANGED
        assert await second.receive() == CHANGED


async def test_assigning_yourself_sends_nothing(work: Work, board: Board) -> None:
    async with sock(work, "editor") as editor:
        await editor.receive()
        await board.create("editor", Name="Mine", Assignee=[board.user("editor")])
        assert await editor.is_quiet()


async def test_a_rejected_request_announces_nothing(work: Work, board: Board) -> None:
    async with sock(work, "member") as member:
        await member.receive()
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
        assert await member.is_quiet()


async def test_reporting_done_tells_the_reviewer(work: Work, board: Board) -> None:
    task = await board.create(
        Name="Launch",
        Assignee=[board.user("member")],
        Status=board.status_options["In progress"],
    )
    async with sock(work, "admin") as admin:
        await admin.receive()
        response = await work.api(
            "POST",
            f"/records/{task['id']}/review",
            "member",
            json={"action": "submit"},
            headers={"If-Match": f'"{task["version"]}"'},
        )
        assert response.status_code == 200, response.text
        assert await admin.receive() == CHANGED


async def test_what_was_missed_while_offline_is_waiting_in_the_inbox(
    work: Work, board: Board
) -> None:
    await board.create(Name="While away", Assignee=[board.user("member")])
    async with sock(work, "member") as member:
        await member.receive()  # "ready": the client now refetches what it missed
        listed = (await work.api("GET", "/notifications", "member")).json()["items"]
        assert [n["record_name"] for n in listed] == ["While away"]


# --- who may connect --------------------------------------------------------------------------


async def test_nobody_connects_without_a_valid_session(work: Work) -> None:
    for cookie in (None, {"Cookie": "workbase_session=not-a-token"}, {"Cookie": ""}):
        async with Socket(work.client, cookie=cookie) as anonymous:
            assert not anonymous.opened
            assert anonymous.close_code == 1008


async def test_a_foreign_origin_is_refused_even_with_a_valid_cookie(work: Work) -> None:
    async with sock(work, "member", origin="https://evil.example") as hijacker:
        assert not hijacker.opened
        assert hijacker.close_code == 1008
    async with sock(work, "member", origin=ALLOWED_ORIGIN) as browser:
        assert browser.opened


async def test_a_signed_out_session_is_disconnected(
    work: Work, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ws, "RECHECK_SECONDS", 0.2)
    async with sock(work, "member") as member:
        assert await member.receive() == {"type": "ready"}
        out = await work.api("DELETE", "/sessions/current", "member")
        assert out.status_code == 204
        message = await member.receive(timeout=3)
        while message is not None:  # a ping may arrive before the check notices
            message = await member.receive(timeout=3)
        assert member.close_code == ws.CLOSE_SESSION_ENDED
    assert hub.count(work.users["member"]) == 0


async def test_a_disabled_employee_is_disconnected(
    work: Work, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(ws, "RECHECK_SECONDS", 0.2)
    async with sock(work, "member") as member:
        await member.receive()
        disabled = await work.api(
            "PATCH", f"/users/{work.users['member']}", "admin", json={"status": "disabled"}
        )
        assert disabled.status_code == 200, disabled.text
        message = await member.receive(timeout=3)
        while message is not None:
            message = await member.receive(timeout=3)
        assert member.close_code == ws.CLOSE_SESSION_ENDED
    # A new connection with the same cookie is refused too.
    async with sock(work, "member") as again:
        assert not again.opened


async def test_a_later_login_is_not_confused_with_an_old_session(work: Work) -> None:
    fresh = await login_as(work.client, "MEMBER")
    work.client.cookies.clear()
    async with Socket(work.client, cookie=fresh) as member:
        assert member.opened


# --- what the client may send -----------------------------------------------------------------


async def test_ping_gets_pong_and_anything_else_is_ignored(work: Work) -> None:
    async with sock(work, "member") as member:
        await member.receive()
        await member.send_text("ping")
        assert await member.receive() == {"type": "pong"}
        for junk in ("", "subscribe:admin", '{"type": "publish"}', "x" * 5000):
            await member.send_text(junk)
        assert await member.is_quiet()
        await member.send_text("ping")  # still alive
        assert await member.receive() == {"type": "pong"}
