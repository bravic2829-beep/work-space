"""A change to a record reaches the screens of the people who can see it, at once."""

import pytest

from tests.test_records import Board
from tests.work_world import Work
from tests.ws_helpers import Socket

CHANGED = {"type": "records.changed"}


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


def sock(work: Work, who: str) -> Socket:
    return Socket(work.client, cookie=work.h[who], include_records=True)


async def ready(socket: Socket) -> None:
    assert await socket.receive() == {"type": "ready"}


async def heard(socket: Socket) -> list[dict[str, str]]:
    """Every message that arrives until things go quiet (a bell signal may come too)."""
    messages: list[dict[str, str]] = []
    while True:
        try:
            message = await socket.receive(timeout=0.5)
        except TimeoutError:
            return messages
        assert message is not None
        messages.append(message)


async def test_the_assignee_is_told_when_the_title_changes(work: Work, board: Board) -> None:
    task = await board.create(Name="Old", Assignee=[board.user("member")])
    async with sock(work, "member") as member:
        await ready(member)
        response = await board.patch(task, "admin", Name="New")
        assert response.status_code == 200, response.text
        assert CHANGED in await heard(member)


async def test_a_new_task_for_the_assignee_is_announced(work: Work, board: Board) -> None:
    async with sock(work, "member") as member:
        await ready(member)
        await board.create("admin", Name="Fresh", Assignee=[board.user("member")])
        assert CHANGED in await heard(member)


async def test_somebody_taken_off_the_task_is_told_too(work: Work, board: Board) -> None:
    task = await board.create(Name="Handed", Assignee=[board.user("member")])
    async with sock(work, "member") as member:
        await ready(member)
        response = await board.patch(task, "admin", Assignee=[board.user("editor")])
        assert response.status_code == 200, response.text
        assert CHANGED in await heard(member)


async def test_reporting_done_tells_the_creator(work: Work, board: Board) -> None:
    task = await board.create(
        "admin",
        Name="Launch",
        Assignee=[board.user("member")],
        Status=board.status_options["In progress"],
    )
    async with sock(work, "admin") as admin:
        await ready(admin)
        response = await work.api(
            "POST",
            f"/records/{task['id']}/review",
            "member",
            json={"action": "submit"},
            headers={"If-Match": f'"{task["version"]}"'},
        )
        assert response.status_code == 200, response.text
        assert CHANGED in await heard(admin)


async def test_deleting_a_task_is_announced(work: Work, board: Board) -> None:
    task = await board.create("editor", Name="Gone", Assignee=[board.user("member")])
    async with sock(work, "member") as member:
        await ready(member)
        response = await work.api("DELETE", f"/records/{task['id']}", "editor")
        assert response.status_code == 204, response.text
        assert CHANGED in await heard(member)


async def test_a_person_with_no_right_to_see_the_task_is_not_told(work: Work, board: Board) -> None:
    """`member2` is not in the workspace and is not named on the task: not even a hint."""
    task = await board.create("editor", Name="Private", Assignee=[board.user("member")])
    async with sock(work, "member2") as stranger:
        await ready(stranger)
        response = await board.patch(task, "editor", Name="Still private")
        assert response.status_code == 200, response.text
        assert await stranger.is_quiet()


async def test_a_rejected_change_announces_nothing(work: Work, board: Board) -> None:
    task = await board.create("editor", Name="Same", Assignee=[board.user("member")])
    async with sock(work, "member") as member:
        await ready(member)
        response = await board.patch(task, "editor", version="999", Name="Nope")
        assert response.status_code == 412
        assert await member.is_quiet()
