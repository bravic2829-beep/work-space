"""The trash: list, restore (only by the person who deleted), empty after 30 days (usecases 3.4)."""

import base64
import subprocess
import sys
import uuid
from datetime import datetime
from typing import Any

import pytest

from tests.api_helpers import assert_problem, db_execute, db_fetch
from tests.helpers import BACKEND_DIR, subprocess_env
from tests.test_records import Board
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def trash(work: Work, who: str, **params: Any) -> Any:
    return await work.api("GET", "/trash/records", who, params=params)


async def trashed(work: Work, who: str) -> list[dict[str, Any]]:
    response = await trash(work, who)
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()["items"]
    return items


async def restore(work: Work, record_id: str, who: str) -> Any:
    return await work.api("POST", f"/records/{record_id}/restore", who)


_DATABASE: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _remember_database(migrated_database_url: str) -> None:
    _DATABASE["url"] = migrated_database_url


async def delete(work: Work, record: dict[str, Any], who: str = "admin") -> None:
    """Put a record in the trash the way an older version did.

    DELETE /records/{id} now removes a record for good, but the trash still has to work for the
    records that were trashed before that change, so the tests mark them directly.
    """
    await db_execute(
        _DATABASE["url"],
        "UPDATE records SET deleted_at = now(), deleted_by = $2, version = version + 1 "
        "WHERE id = $1",
        uuid.UUID(record["id"]),
        work.users[who],
    )


# --- the loop ---------------------------------------------------------------------------------


async def test_delete_list_restore(work: Work, board: Board) -> None:
    record = await board.create(Name="Launch", Assignee=[board.user("member")])
    await delete(work, record)

    items = await trashed(work, "admin")
    assert len(items) == 1
    item = items[0]
    assert (item["id"], item["name"], item["table_name"]) == (record["id"], "Launch", "Tasks")
    assert item["table_id"] == board.id
    # It is gone from the table and from the inbox of the assignee.
    listing = (await work.api("GET", f"/tables/{board.id}/records", "admin")).json()
    assert listing["items"] == []
    assert len((await work.api("GET", "/notifications", "member")).json()["items"]) == 0

    restored = await restore(work, record["id"], "admin")
    assert restored.status_code == 200, restored.text
    assert restored.json()["data"][board.f["Name"]] == "Launch"
    assert restored.json()["version"] > record["version"]
    assert restored.headers["etag"] == f'"{restored.json()["version"]}"'
    assert await trashed(work, "admin") == []
    listing = (await work.api("GET", f"/tables/{board.id}/records", "admin")).json()
    assert [r["id"] for r in listing["items"]] == [record["id"]]
    # The assignee sees the task and the notification again.
    assert (await work.api("GET", f"/records/{record['id']}", "member")).status_code == 200
    assert len((await work.api("GET", "/notifications", "member")).json()["items"]) == 1


async def test_purge_at_is_thirty_days_after_the_deletion(work: Work, board: Board) -> None:
    await delete(work, await board.create(Name="Old"))
    item = (await trashed(work, "admin"))[0]
    deleted = datetime.fromisoformat(item["deleted_at"])
    purge = datetime.fromisoformat(item["purge_at"])
    assert (purge - deleted).days == 30


async def test_a_restored_subtask_keeps_its_parent(work: Work, board: Board) -> None:
    parent = await board.create(Name="Parent")
    child = await board.create(Name="Child", **{"Parent task": [parent["id"]]})
    await delete(work, child)
    assert (await restore(work, child["id"], "admin")).status_code == 200
    again = (await work.api("GET", f"/records/{child['id']}", "admin")).json()
    assert again["data"][board.f["Parent task"]] == [parent["id"]]


# --- refused ----------------------------------------------------------------------------------


async def test_only_the_person_who_deleted_a_record_sees_or_restores_it(
    work: Work, board: Board
) -> None:
    record = await board.create("editor", Name="Mine")
    await delete(work, record, "editor")

    # Not another editor, not an outsider: nobody else sees it or brings it back.
    for who in ("wsadmin", "member"):
        assert await trashed(work, who) == []
        assert_problem(await restore(work, record["id"], who), 403)
    assert len(await trashed(work, "editor")) == 1
    assert_problem(await restore(work, record["id"], "other_admin"), 404)
    assert (await work.api("GET", f"/records/{record['id']}", "editor")).status_code == 404
    # The organization admin sees everybody's trash and may bring it back.
    assert [r["id"] for r in await trashed(work, "admin")] == [record["id"]]
    assert (await restore(work, record["id"], "admin")).status_code == 200


async def test_a_record_that_is_not_in_the_trash_cannot_be_restored(
    work: Work, board: Board
) -> None:
    live = await board.create(Name="Live")
    assert_problem(await restore(work, live["id"], "admin"), 404)
    assert_problem(await restore(work, str(uuid.uuid4()), "admin"), 404)

    await delete(work, live)
    assert (await restore(work, live["id"], "admin")).status_code == 200
    assert_problem(await restore(work, live["id"], "admin"), 404)  # twice


async def test_after_thirty_days_the_record_can_no_longer_be_restored(
    work: Work, board: Board, migrated_database_url: str
) -> None:
    old = await board.create(Name="Old")
    fresh = await board.create(Name="Fresh")
    await delete(work, old)
    await delete(work, fresh)
    await db_execute(
        migrated_database_url,
        "UPDATE records SET deleted_at = now() - interval '31 days' WHERE id = $1",
        uuid.UUID(old["id"]),
    )
    assert [i["name"] for i in await trashed(work, "admin")] == ["Fresh"]
    assert_problem(await restore(work, old["id"], "admin"), 404)
    assert (await restore(work, fresh["id"], "admin")).status_code == 200


async def test_a_record_of_a_deleted_table_cannot_be_restored(work: Work, board: Board) -> None:
    record = await board.create(Name="Doomed")
    await delete(work, record)
    assert (await work.api("DELETE", f"/tables/{board.id}", "admin")).status_code == 204
    assert await trashed(work, "admin") == []
    assert_problem(await restore(work, record["id"], "admin"), 404)


async def test_a_hidden_title_column_does_not_leak_into_the_trash(work: Work, board: Board) -> None:
    hidden = await work.api(
        "PUT",
        f"/fields/{board.f['Name']}/access/{board.user('editor')}",
        json={"access": "hidden"},
    )
    assert hidden.status_code == 200, hidden.text
    record = await board.create("editor", Assignee=[board.user("editor")])
    await delete(work, record, "editor")
    assert (await trashed(work, "editor"))[0]["name"] is None


async def delete_forever(work: Work, record_id: str, who: str) -> Any:
    return await work.api("DELETE", f"/trash/records/{record_id}", who)


async def test_the_person_who_deleted_a_record_can_remove_it_for_good(
    work: Work, board: Board, migrated_database_url: str
) -> None:
    record = await board.create("editor", Name="Mine", Assignee=[board.user("member")])
    await delete(work, record, "editor")

    assert (await delete_forever(work, record["id"], "editor")).status_code == 204

    assert await trashed(work, "editor") == []
    assert_problem(await restore(work, record["id"], "editor"), 404)
    rows = await db_fetch(
        migrated_database_url, "SELECT 1 FROM records WHERE id = $1", uuid.UUID(record["id"])
    )
    assert rows == []
    assert_problem(await delete_forever(work, record["id"], "editor"), 404)  # twice


async def test_an_organization_admin_can_remove_anyones_trashed_record(
    work: Work, board: Board
) -> None:
    record = await board.create("editor", Name="Theirs")
    await delete(work, record, "editor")
    assert (await delete_forever(work, record["id"], "admin")).status_code == 204
    assert await trashed(work, "admin") == []


async def test_nobody_else_can_remove_a_trashed_record_for_good(work: Work, board: Board) -> None:
    record = await board.create("editor", Name="Mine")
    await delete(work, record, "editor")

    for who in ("wsadmin", "member"):
        assert_problem(await delete_forever(work, record["id"], who), 403)
    assert_problem(await delete_forever(work, record["id"], "other_admin"), 404)
    assert len(await trashed(work, "editor")) == 1


async def test_a_live_record_cannot_be_removed_through_the_trash(work: Work, board: Board) -> None:
    live = await board.create(Name="Live")
    assert_problem(await delete_forever(work, live["id"], "admin"), 404)
    assert_problem(await delete_forever(work, str(uuid.uuid4()), "admin"), 404)
    assert (await work.api("GET", f"/records/{live['id']}", "admin")).status_code == 200


async def test_the_trash_needs_a_login(work: Work, board: Board) -> None:
    record = await board.create(Name="x")
    assert_problem(await work.client.delete(f"/api/v1/trash/records/{record['id']}"), 401)
    assert_problem(await work.client.get("/api/v1/trash/records"), 401)
    assert_problem(await work.client.post(f"/api/v1/records/{record['id']}/restore"), 401)


@pytest.mark.parametrize("limit", [0, 101])
async def test_the_limit_is_checked(work: Work, limit: int) -> None:
    assert_problem(await trash(work, "admin", limit=limit), 422)


@pytest.mark.parametrize(
    "cursor", ["garbage", base64.urlsafe_b64encode(b"2026-01-01T00:00:00|x").decode()]
)
async def test_a_forged_cursor_is_refused(work: Work, cursor: str) -> None:
    assert_problem(await trash(work, "admin", cursor=cursor), 422)


async def test_the_trash_is_paged_without_gaps(work: Work, board: Board) -> None:
    ids = []
    for index in range(5):
        record = await board.create(Name=f"T{index}")
        await delete(work, record)
        ids.append(record["id"])
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params: dict[str, Any] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = (await trash(work, "admin", **params)).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == list(reversed(ids))


# --- emptying ---------------------------------------------------------------------------------


def purge(database_url: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "app.cli", "purge-trash"],
        cwd=BACKEND_DIR,
        env=subprocess_env(database_url),
        capture_output=True,
        text=True,
        check=False,
    )


async def test_the_purge_command_removes_only_what_is_older_than_thirty_days(
    work: Work, board: Board, migrated_database_url: str
) -> None:
    old = await board.create(Name="Old", Assignee=[board.user("member")])
    recent = await board.create(Name="Recent", Assignee=[board.user("member")])
    live = await board.create(Name="Live")
    await work.api(
        "POST", f"/records/{old['id']}/comments", "member", json={"body": "to be removed too"}
    )
    for record in (old, recent):
        await delete(work, record)
    await db_execute(
        migrated_database_url,
        "UPDATE records SET deleted_at = now() - interval '31 days' WHERE id = $1",
        uuid.UUID(old["id"]),
    )
    await db_execute(
        migrated_database_url,
        "UPDATE records SET deleted_at = now() - interval '29 days' WHERE id = $1",
        uuid.UUID(recent["id"]),
    )

    done = purge(migrated_database_url)
    assert done.returncode == 0, done.stderr
    assert "Removed 1 record(s)" in done.stdout

    left = {str(r["id"]) for r in await db_fetch(migrated_database_url, "SELECT id FROM records")}
    assert left == {recent["id"], live["id"]}
    # What hung on the removed record went with it.
    for table in ("comments", "notifications", "record_viewers"):
        rows = await db_fetch(
            migrated_database_url,
            f"SELECT 1 FROM {table} WHERE record_id = $1",  # noqa: S608 (fixed table names)
            uuid.UUID(old["id"]),
        )
        assert rows == [], table
    # Running it again has nothing left to do.
    assert "Removed 0 record(s)" in purge(migrated_database_url).stdout
    assert (await restore(work, recent["id"], "admin")).status_code == 200
