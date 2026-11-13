"""The whole Phase 4 story in one run, through the API and the WebSocket.

A boss gives a task to a department head. The head splits it and gives a subtask to an
employee. The employee reports it done, the head approves it, the head reports the parent up
and the boss approves. Along the way people are told, comment, delete and restore.
"""

from typing import Any

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.work_world import Work
from tests.ws_helpers import Socket

CHANGED = {"type": "notifications.changed"}


async def test_the_whole_story(work: Work) -> None:
    board = Board(work, await work.make_table(await work.make_base(), "Tasks", template="tasks"))
    boss, head, worker = "admin", "member", "member2"  # head and worker are outside the workspace
    department = await work.api(
        "POST",
        "/departments",
        json={"name": "Sales", "kind": "division", "head_user_id": board.user(head)},
    )
    assert department.status_code == 201, department.text

    async with Socket(work.client, cookie=work.h[head]) as head_socket:
        async with Socket(work.client, cookie=work.h[worker]) as worker_socket:
            async with Socket(work.client, cookie=work.h[boss]) as boss_socket:
                for socket in (head_socket, worker_socket, boss_socket):
                    assert await socket.receive() == {"type": "ready"}

                # 1. The boss gives a task to the head. Only the head is told.
                parent = await board.create(
                    Name="Launch campaign",
                    Assignee=[board.user(head)],
                    Status=board.status_options["In progress"],
                    **{"Due date": "2026-11-13"},
                )
                assert await head_socket.receive() == CHANGED
                assert await worker_socket.is_quiet()
                assert await boss_socket.is_quiet()

                # 2. The worker cannot see the parent, nor split anything.
                assert_problem(await work.api("GET", f"/records/{parent['id']}", worker), 403)

                # 3. The head splits it and gives the subtask to the worker.
                made = await work.api(
                    "POST",
                    f"/tables/{board.id}/records",
                    head,
                    json={
                        "data": {
                            board.f["Name"]: "Design banner",
                            board.f["Parent task"]: [parent["id"]],
                            board.f["Assignee"]: [board.user(worker)],
                            board.f["Status"]: board.status_options["In progress"],
                        }
                    },
                )
                assert made.status_code == 201, made.text
                subtask = made.json()
                assert await worker_socket.receive() == CHANGED
                assert await head_socket.is_quiet()  # nobody is told about their own action

                # 4. Both can talk about it; a stranger cannot.
                said = await work.api(
                    "POST", f"/records/{subtask['id']}/comments", worker, json={"body": "On it"}
                )
                assert said.status_code == 201
                reply = await work.api(
                    "POST", f"/records/{subtask['id']}/comments", head, json={"body": "Thanks"}
                )
                assert reply.status_code == 201
                thread = await work.api("GET", f"/records/{subtask['id']}/comments", head)
                assert [c["body"] for c in thread.json()["items"]] == ["On it", "Thanks"]
                url = f"/records/{subtask['id']}/comments"
                assert_problem(await work.api("GET", url, "other_admin"), 404)

                # 5. The worker reports the subtask done; the head (its creator) is told.
                current = (await work.api("GET", f"/records/{subtask['id']}", worker)).json()
                submitted = await review(work, current, worker, "submit")
                assert submitted.status_code == 200, submitted.text
                assert await head_socket.receive() == CHANGED
                assert await boss_socket.is_quiet()

                # 6. The head approves. Nobody is told (only two events notify).
                approved = await review(work, submitted.json(), head, "approve")
                assert approved.status_code == 200, approved.text
                assert await worker_socket.is_quiet()

                # 7. The head reports the parent to the boss, who approves.
                parent_now = (await work.api("GET", f"/records/{parent['id']}", head)).json()
                up = await review(work, parent_now, head, "submit")
                assert up.status_code == 200, up.text
                assert await boss_socket.receive() == CHANGED
                final = await review(work, up.json(), boss, "approve")
                assert final.status_code == 200, final.text

    # What each person has in the inbox, and the tasks they have.
    assert await kinds(work, head) == ["review_requested", "task_assigned"]
    assert await kinds(work, worker) == ["task_assigned"]
    assert await kinds(work, boss) == ["review_requested"]
    assert await titles(work, head) == ["Launch campaign"]
    assert await titles(work, worker) == ["Design banner"]
    due = await work.api("GET", "/me/tasks", head, params={"scope": "today", "date": "2026-11-13"})
    assert [t["name"] for t in due.json()["items"]] == ["Launch campaign"]
    assert due.json()["items"][0]["status"]["kind"] == "done"

    # 8. The head deletes the subtask they made, finds it in the trash and brings it back.
    sub_id = subtask["id"]
    assert (await work.api("DELETE", f"/records/{sub_id}", head)).status_code == 204
    assert await titles(work, worker) == []
    assert [i["id"] for i in (await work.api("GET", "/trash/records", head)).json()["items"]] == [
        sub_id
    ]
    assert_problem(await work.api("POST", f"/records/{sub_id}/restore", worker), 403)
    assert (await work.api("POST", f"/records/{sub_id}/restore", head)).status_code == 200
    assert await titles(work, worker) == ["Design banner"]
    assert len((await work.api("GET", f"/records/{sub_id}/comments", head)).json()["items"]) == 2


async def review(work: Work, record: dict[str, Any], who: str, action: str) -> Any:
    return await work.api(
        "POST",
        f"/records/{record['id']}/review",
        who,
        json={"action": action},
        headers={"If-Match": f'"{record["version"]}"'},
    )


async def kinds(work: Work, who: str) -> list[str]:
    items = (await work.api("GET", "/notifications", who)).json()["items"]
    return sorted(n["type"] for n in items)


async def titles(work: Work, who: str) -> list[str]:
    items = (await work.api("GET", "/me/tasks", who)).json()["items"]
    return [t["name"] for t in items]
