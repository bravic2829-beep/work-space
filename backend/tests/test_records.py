import asyncio
import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem, db_fetch
from tests.work_world import Work

MISSING = str(uuid.uuid4())


class Board:
    """A tasks table with the ids of its columns by name."""

    def __init__(self, work: Work, table: dict[str, Any]) -> None:
        self.work = work
        self.id: str = table["id"]
        self.f: dict[str, str] = {f["name"]: f["id"] for f in table["fields"]}
        self.status_options: dict[str, str] = {
            o["name"]: o["id"]
            for f in table["fields"]
            if f["name"] == "Status"
            for o in f["config"]["options"]
        }

    def user(self, name: str) -> str:
        return str(self.work.users[name])

    async def create(self, who: str = "admin", /, **cells: Any) -> dict[str, Any]:
        """Create a record. Keys are column names, `assignee` and so on are written by name."""
        response = await self.work.api(
            "POST",
            f"/tables/{self.id}/records",
            who,
            json={"data": {self.f[name]: value for name, value in cells.items()}},
        )
        assert response.status_code == 201, response.text
        body: dict[str, Any] = response.json()
        return body

    async def patch(
        self,
        record: dict[str, Any],
        who: str = "admin",
        /,
        *,
        version: Any = None,
        **cells: Any,
    ) -> Any:
        return await self.work.api(
            "PATCH",
            f"/records/{record['id']}",
            who,
            json={"data": {self.f[name]: value for name, value in cells.items()}},
            headers={"If-Match": f'"{record["version"] if version is None else version}"'},
        )


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


# --- create ----------------------------------------------------------------------------------


async def test_editor_creates_a_record(board: Board) -> None:
    response = await board.work.api(
        "POST",
        f"/tables/{board.id}/records",
        "editor",
        json={"data": {board.f["Name"]: "Write report"}},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["data"] == {
        board.f["Name"]: "Write report",
        board.f["Parent task"]: [],
        board.f["Subtasks"]: [],
        board.f["Files"]: [],
    }
    assert body["created_by"] == board.user("editor")
    assert body["version"] == 1
    assert response.headers["etag"] == '"1"'
    assert response.headers["location"] == f"/api/v1/records/{body['id']}"


async def test_every_field_type_can_hold_a_value(work: Work) -> None:
    base_id = await work.make_base()
    table = await work.make_table(base_id, "Everything")
    t = table["id"]
    fields = {
        "text": await work.make_field(t, "Text", "text"),
        "long": await work.make_field(t, "Long", "long_text"),
        "num": await work.make_field(t, "Num", "number", config={"precision": 2}),
        "date": await work.make_field(t, "Date", "date"),
        "when": await work.make_field(t, "When", "date", config={"include_time": True}),
        "check": await work.make_field(t, "Check", "checkbox"),
        "url": await work.make_field(t, "Url", "url"),
        "pick": await work.make_field(
            t, "Pick", "single_select", config={"options": [{"name": "A"}, {"name": "B"}]}
        ),
        "tags": await work.make_field(
            t, "Tags", "multi_select", config={"options": [{"name": "x"}, {"name": "y"}]}
        ),
        "status": await work.make_field(t, "State", "status"),
        "people": await work.make_field(t, "People", "user"),
        "by": await work.make_field(t, "By", "created_by"),
        "at": await work.make_field(t, "At", "created_time"),
        "n": await work.make_field(t, "N", "auto_number"),
    }
    pick_a = fields["pick"]["config"]["options"][0]["id"]
    tag_ids = [o["id"] for o in fields["tags"]["config"]["options"]]
    done = fields["status"]["config"]["options"][3]["id"]
    values = {
        fields["text"]["id"]: "xin chào 你好",
        fields["long"]["id"]: "line1\nline2",
        fields["num"]["id"]: "12.345",
        fields["date"]["id"]: "2026-11-13",
        fields["when"]["id"]: "2026-11-13T09:00:00+07:00",
        fields["check"]["id"]: True,
        fields["url"]["id"]: "https://example.com/x",
        fields["pick"]["id"]: pick_a,
        fields["tags"]["id"]: tag_ids,
        fields["status"]["id"]: done,
        fields["people"]["id"]: [str(work.users["viewer"])],
    }
    response = await work.api("POST", f"/tables/{t}/records", json={"data": values})
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    assert data[fields["text"]["id"]] == "xin chào 你好"
    assert data[fields["num"]["id"]] == 12.35
    assert data[fields["when"]["id"]] == "2026-11-13T02:00:00Z"
    assert data[fields["tags"]["id"]] == tag_ids
    assert data[fields["people"]["id"]] == [str(work.users["viewer"])]
    assert data[fields["by"]["id"]] == str(work.users["admin"])
    assert data[fields["at"]["id"]].startswith("20")
    assert data[fields["n"]["id"]] == 1

    second = await work.api("POST", f"/tables/{t}/records", json={"data": {}})
    assert second.json()["data"][fields["n"]["id"]] == 2


async def test_only_editors_create_records(board: Board) -> None:
    for who in ("viewer", "commenter", "member"):
        response = await board.work.api(
            "POST", f"/tables/{board.id}/records", who, json={"data": {}}
        )
        assert_problem(response, 403)
    assert_problem(
        await board.work.api(
            "POST", f"/tables/{board.id}/records", "other_admin", json={"data": {}}
        ),
        404,
    )
    assert_problem(
        await board.work.api("POST", f"/tables/{MISSING}/records", json={"data": {}}), 404
    )
    assert_problem(await board.work.api("POST", f"/tables/{board.id}/records", "nobody"), 401)


async def test_invalid_values_are_listed_by_field(board: Board) -> None:
    response = await board.work.api(
        "POST",
        f"/tables/{board.id}/records",
        json={
            "data": {
                board.f["Name"]: 987654321,
                board.f["Due date"]: "tomorrow",
                board.f["Status"]: "not-an-option",
            }
        },
    )
    body = assert_problem(response, 422)
    fields_with_errors = {e["field"] for e in body["errors"]}  # type: ignore[attr-defined]
    assert fields_with_errors == {board.f["Name"], board.f["Due date"], board.f["Status"]}
    assert "987654321" not in response.text  # the value is not echoed back


async def test_unknown_and_computed_fields_and_extra_keys_are_rejected(work: Work) -> None:
    base_id = await work.make_base()
    table = await work.make_table(base_id, "T")
    auto = await work.make_field(table["id"], "N", "auto_number")
    by = await work.make_field(table["id"], "By", "created_by")
    url = f"/tables/{table['id']}/records"
    assert_problem(await work.api("POST", url, json={"data": {MISSING: "x"}}), 422)
    assert_problem(await work.api("POST", url, json={"data": {"not-a-uuid": "x"}}), 422)
    assert_problem(await work.api("POST", url, json={"data": {auto["id"]: 5}}), 422)
    assert_problem(await work.api("POST", url, json={"data": {by["id"]: MISSING}}), 422)
    assert_problem(await work.api("POST", url, json={"data": {}, "created_by": MISSING}), 422)
    assert_problem(await work.api("POST", url, json={"data": {}, "version": 9}), 422)
    assert_problem(await work.api("POST", url, json={"data": "nope"}), 422)
    assert_problem(await work.api("POST", url, json=[]), 422)


async def test_a_deleted_field_is_unknown(work: Work) -> None:
    table = await work.make_table(await work.make_base(), "T")
    extra = await work.make_field(table["id"], "Extra", "text")
    await work.api("DELETE", f"/fields/{extra['id']}")
    response = await work.api(
        "POST", f"/tables/{table['id']}/records", json={"data": {extra["id"]: "x"}}
    )
    assert_problem(response, 422)


async def test_required_fields(work: Work) -> None:
    table = await work.make_table(await work.make_base(), "T")
    code = await work.make_field(table["id"], "Code", "text", is_required=True)
    url = f"/tables/{table['id']}/records"
    assert_problem(await work.api("POST", url, json={"data": {}}), 422)
    assert_problem(await work.api("POST", url, json={"data": {code["id"]: None}}), 422)
    created = await work.api("POST", url, json={"data": {code["id"]: "A1"}})
    assert created.status_code == 201
    record = created.json()
    cleared = await work.api(
        "PATCH",
        f"/records/{record['id']}",
        json={"data": {code["id"]: None}},
        headers={"If-Match": '"1"'},
    )
    assert_problem(cleared, 422)


async def test_user_fields_only_take_active_employees_of_the_organization(
    board: Board, migrated_database_url: str
) -> None:
    from app.modules.users.models import UserStatus
    from tests.factories import create_user

    await create_user(migrated_database_url, employee_code="GONE", status=UserStatus.DISABLED)
    gone = (
        await db_fetch(migrated_database_url, "SELECT id FROM users WHERE employee_code = 'GONE'")
    )[0]["id"]
    url = f"/tables/{board.id}/records"
    for bad in (MISSING, str(gone), str(board.work.other["user_id"])):
        response = await board.work.api("POST", url, json={"data": {board.f["Assignee"]: [bad]}})
        assert_problem(response, 422)
    ok = await board.work.api(
        "POST",
        url,
        json={"data": {board.f["Assignee"]: [board.user("member"), board.user("member")]}},
    )
    assert ok.status_code == 201
    assert ok.json()["data"][board.f["Assignee"]] == [board.user("member")]


# --- who sees a record -----------------------------------------------------------------------


async def test_workspace_members_and_admins_see_every_record(board: Board) -> None:
    record = await board.create(Name="Secret plan")
    for who in ("admin", "wsadmin", "editor", "commenter", "viewer"):
        response = await board.work.api("GET", f"/records/{record['id']}", who)
        assert response.status_code == 200, who
        assert response.headers["etag"] == '"1"'


async def test_a_stranger_cannot_open_a_record(board: Board) -> None:
    record = await board.create(Name="Secret plan")
    url = f"/records/{record['id']}"
    assert_problem(await board.work.api("GET", url, "member"), 403)
    assert_problem(await board.work.api("GET", url, "member2"), 403)
    assert_problem(await board.work.api("GET", url, "other_admin"), 404)
    assert_problem(await board.work.api("GET", f"/records/{MISSING}"), 404)
    assert_problem(await board.work.api("GET", url, "nobody"), 401)


async def test_the_assignee_sees_the_record_and_only_that_one(board: Board) -> None:
    mine = await board.create(Name="For member", Assignee=[board.user("member")])
    other = await board.create(Name="Not for member")
    assert (await board.work.api("GET", f"/records/{mine['id']}", "member")).status_code == 200
    assert_problem(await board.work.api("GET", f"/records/{other['id']}", "member"), 403)
    # Having a task is enough to open the table, to see its columns.
    table = await board.work.api("GET", f"/tables/{board.id}", "member")
    assert table.status_code == 200
    assert table.json()["my_role"] is None
    assert {f["access"] for f in table.json()["fields"]} == {"read"}


async def test_followers_see_the_record_but_a_plain_user_field_does_not_grant_view(
    board: Board,
) -> None:
    work = board.work
    plain = await work.make_field(board.id, "Reviewer", "user")  # grants_view is off
    board.f["Reviewer"] = plain["id"]
    follower = await board.create(Name="F", Follower=[board.user("member")])
    reviewed = await board.create(Name="R", **{"Reviewer": [board.user("member2")]})
    assert plain["grants_view"] is False
    assert (await work.api("GET", f"/records/{follower['id']}", "member")).status_code == 200
    assert_problem(await work.api("GET", f"/records/{reviewed['id']}", "member2"), 403)


async def test_changing_the_assignee_moves_the_access(
    board: Board, migrated_database_url: str
) -> None:
    work = board.work
    record = await board.create(Name="Handover", Assignee=[board.user("member")])
    url = f"/records/{record['id']}"
    assert (await work.api("GET", url, "member")).status_code == 200
    assert_problem(await work.api("GET", url, "member2"), 403)

    moved = await board.patch(record, Assignee=[board.user("member2")])
    assert moved.status_code == 200, moved.text
    assert_problem(await work.api("GET", url, "member"), 403)  # the old assignee loses it at once
    assert (await work.api("GET", url, "member2")).status_code == 200

    rows = await db_fetch(
        migrated_database_url,
        "SELECT user_id, reason FROM record_viewers WHERE record_id = $1 ORDER BY reason",
        uuid.UUID(record["id"]),
    )
    assert {(str(r["user_id"]), r["reason"]) for r in rows} == {
        (board.user("admin"), "creator"),
        (board.user("member2"), "field"),
    }


async def test_leader_above_the_assignee_does_not_automatically_see_it(board: Board) -> None:
    """Level gives no access (usecases.md 3.1): only people named in the record see it."""
    record = await board.create(Name="Skip level", Assignee=[board.user("member")])
    assert_problem(await board.work.api("GET", f"/records/{record['id']}", "member2"), 403)


async def test_deleting_the_assignee_field_removes_the_access_it_gave(board: Board) -> None:
    record = await board.create(Name="X", Assignee=[board.user("member")])
    url = f"/records/{record['id']}"
    assert (await board.work.api("GET", url, "member")).status_code == 200
    await board.work.api("DELETE", f"/fields/{board.f['Assignee']}")
    assert_problem(await board.work.api("GET", url, "member"), 403)


async def test_a_person_can_be_in_two_fields_of_the_same_record(
    board: Board, migrated_database_url: str
) -> None:
    both = board.user("member")
    record = await board.create(Name="Both", Assignee=[both], Follower=[both])
    rows = await db_fetch(
        migrated_database_url,
        "SELECT source_key FROM record_viewers WHERE record_id = $1 AND user_id = $2",
        uuid.UUID(record["id"]),
        uuid.UUID(both),
    )
    assert len(rows) == 2
    await board.patch(record, Follower=None)
    rows = await db_fetch(
        migrated_database_url,
        "SELECT source_key FROM record_viewers WHERE record_id = $1 AND user_id = $2",
        uuid.UUID(record["id"]),
        uuid.UUID(both),
    )
    assert len(rows) == 1


async def test_hidden_columns_are_not_returned_or_writable(board: Board) -> None:
    work = board.work
    record = await board.create(Name="Plan", Assignee=[board.user("viewer")])
    await work.api(
        "PUT",
        f"/fields/{board.f['Due date']}/access/{board.user('viewer')}",
        json={"access": "hidden"},
    )
    await board.patch(record, **{"Due date": "2026-12-31"})
    seen = (await work.api("GET", f"/records/{record['id']}", "viewer")).json()
    assert board.f["Due date"] not in seen["data"]
    assert board.f["Name"] in seen["data"]
    full = (await work.api("GET", f"/records/{record['id']}", "editor")).json()
    assert full["data"][board.f["Due date"]] == "2026-12-31"
    # Trying to write a hidden column looks like writing a column that does not exist.
    response = await work.api(
        "PATCH",
        f"/records/{record['id']}",
        "viewer",
        json={"data": {board.f["Due date"]: "2027-01-01"}},
        headers={"If-Match": '"2"'},
    )
    assert response.status_code in (403, 422)


# --- update ----------------------------------------------------------------------------------


async def test_editor_updates_some_cells_and_the_version_goes_up(board: Board) -> None:
    record = await board.create(Name="Draft", **{"Due date": "2026-12-01"})
    response = await board.patch(record, "editor", Name="Final")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 2
    assert response.headers["etag"] == '"2"'
    assert body["data"][board.f["Name"]] == "Final"
    assert body["data"][board.f["Due date"]] == "2026-12-01"  # untouched
    assert body["updated_at"] >= record["updated_at"]


async def test_null_clears_a_cell(board: Board) -> None:
    record = await board.create(Name="Draft", **{"Due date": "2026-12-01"})
    response = await board.patch(record, **{"Due date": None})
    assert response.status_code == 200
    assert board.f["Due date"] not in response.json()["data"]


async def test_updating_needs_the_current_version(board: Board) -> None:
    record = await board.create(Name="Draft")
    url = f"/records/{record['id']}"
    body = {"data": {board.f["Name"]: "x"}}
    assert_problem(await board.work.api("PATCH", url, json=body), 428)
    assert_problem(await board.work.api("PATCH", url, json=body, headers={"If-Match": '"7"'}), 412)
    assert_problem(await board.work.api("PATCH", url, json=body, headers={"If-Match": "abc"}), 400)
    ok = await board.work.api("PATCH", url, json=body, headers={"If-Match": 'W/"1"'})
    assert ok.status_code == 200
    stale = await board.work.api("PATCH", url, json=body, headers={"If-Match": '"1"'})
    assert_problem(stale, 412)


async def test_two_people_saving_at_once_do_not_overwrite_each_other(board: Board) -> None:
    record = await board.create(Name="Draft")
    first, second = await asyncio.gather(
        board.patch(record, "admin", Name="Admin was here"),
        board.patch(record, "editor", Name="Editor was here"),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 412]


async def test_an_update_that_changes_nothing_keeps_the_version(board: Board) -> None:
    record = await board.create(Name="Same")
    response = await board.patch(record, Name="Same")
    assert response.status_code == 200
    assert response.json()["version"] == 1


async def test_people_without_edit_rights_cannot_update(board: Board) -> None:
    record = await board.create(Name="Draft", Assignee=[board.user("member")])
    for who in ("viewer", "commenter", "member"):  # member is the assignee: read only
        assert_problem(await board.patch(record, who, Name="Changed"), 403)
    assert_problem(await board.patch(record, "member2", Name="Changed"), 403)
    assert_problem(await board.patch(record, "other_admin", Name="Changed"), 404)
    assert_problem(await board.patch(record, "nobody", Name="Changed"), 401)
    again = (await board.work.api("GET", f"/records/{record['id']}")).json()
    assert again["data"][board.f["Name"]] == "Draft"
    assert again["version"] == 1


async def test_a_column_that_is_read_only_for_you_cannot_be_written(board: Board) -> None:
    work = board.work
    record = await board.create(Name="Draft")
    await work.api(
        "PUT",
        f"/fields/{board.f['Name']}/access/{board.user('editor')}",
        json={"access": "read"},
    )
    assert_problem(await board.patch(record, "editor", Name="Changed"), 403)
    assert (await board.patch(record, "editor", **{"Due date": "2026-12-01"})).status_code == 200


async def test_a_column_rule_never_lets_an_assignee_write_but_a_sheet_does(
    board: Board,
) -> None:
    """Column rules only narrow. An assignee who only reads the task stays read-only even with
    "edit" on a column; giving them a sheet (editor) is how they get to write."""
    work = board.work
    record = await board.create(Name="Draft", Assignee=[board.user("member")])
    await work.api(
        "PUT",
        f"/fields/{board.f['Due date']}/access/{board.user('member')}",
        json={"access": "edit"},
    )
    assert_problem(await board.patch(record, "member", **{"Due date": "2026-12-01"}), 403)

    sheet = await work.api(
        "POST", f"/tables/{board.id}/sheets", json={"owner_id": board.user("member")}
    )
    assert sheet.status_code == 201, sheet.text
    assert (await board.patch(record, "member", **{"Due date": "2026-12-01"})).status_code == 200
    # A rule still narrows the sheet: "read" on Name stops the editor there.
    await work.api(
        "PUT",
        f"/fields/{board.f['Name']}/access/{board.user('member')}",
        json={"access": "read"},
    )
    fresh = (await work.api("GET", f"/records/{record['id']}", "member")).json()
    assert_problem(await board.patch(fresh, "member", Name="Nope"), 403)


async def test_the_creator_edits_their_own_record_even_when_not_a_workspace_member(
    board: Board, migrated_database_url: str
) -> None:
    work = board.work
    record = await board.create("editor", Name="Mine")
    removed = await work.api(
        "DELETE", f"/workspaces/{work.workspace_id}/members/{board.user('editor')}"
    )
    assert removed.status_code == 204
    # No longer a member: cannot create any more, but still sees and edits what they made.
    assert_problem(
        await work.api("POST", f"/tables/{board.id}/records", "editor", json={"data": {}}), 403
    )
    ok = await board.patch(record, "editor", Name="Still mine")
    assert ok.status_code == 200, ok.text
    other = await board.create("admin", Name="Not mine")
    assert_problem(await board.patch(other, "editor", Name="x"), 403)


# --- delete ----------------------------------------------------------------------------------


async def test_only_the_creator_deletes_a_record(board: Board, migrated_database_url: str) -> None:
    work = board.work
    record = await board.create("editor", Name="Mine", Assignee=[board.user("member")])
    url = f"/records/{record['id']}"
    # Not a workspace admin, nor the assignee (docs/usecases.md 3.2). The organization admin
    # may: see test_the_organization_admin_deletes_any_record.
    for who in ("wsadmin", "member", "viewer", "member2"):
        assert_problem(await work.api("DELETE", url, who), 403)
    assert_problem(await work.api("DELETE", url, "other_admin"), 404)
    assert (await work.api("DELETE", url, "editor")).status_code == 204
    assert_problem(await work.api("GET", url), 404)
    assert_problem(await work.api("DELETE", url, "editor"), 404)
    # Deleted for good: the row is gone, not only marked (there is no trash step).
    rows = await db_fetch(
        migrated_database_url, "SELECT id FROM records WHERE id = $1", uuid.UUID(record["id"])
    )
    assert rows == []


async def test_the_organization_admin_deletes_any_record(board: Board) -> None:
    record = await board.create("editor", Name="Not the admin's")
    assert (await board.work.api("DELETE", f"/records/{record['id']}", "admin")).status_code == 204


async def test_a_deleted_record_cannot_be_changed(board: Board) -> None:
    record = await board.create(Name="Gone")
    await board.work.api("DELETE", f"/records/{record['id']}")
    assert_problem(await board.patch(record, Name="Back"), 404)


async def test_records_of_a_deleted_table_are_unreachable(board: Board) -> None:
    record = await board.create(Name="Inside")
    await board.work.api("DELETE", f"/tables/{board.id}")
    assert_problem(await board.work.api("GET", f"/records/{record['id']}"), 404)


# --- record_viewers is derived data ----------------------------------------------------------


async def test_record_viewers_always_match_the_data(
    board: Board, migrated_database_url: str
) -> None:
    """After a series of changes the table equals what rebuilding from `data` would give."""
    from sqlalchemy import select

    from app.core.db import create_engine, create_sessionmaker
    from app.modules.fields import repository as fields_repo
    from app.modules.records.models import Record, RecordViewer
    from app.modules.records.visibility import wanted_viewers

    a, b, c = board.user("member"), board.user("member2"), board.user("viewer")
    one = await board.create(Name="1", Assignee=[a])
    two = await board.create("editor", Name="2", Assignee=[a, b], Follower=[c])
    one = (await board.patch(one, Assignee=[b], Follower=[a])).json()
    await board.patch(two, Assignee=[c])
    await board.patch(one, Follower=None)

    engine = create_engine(migrated_database_url)
    try:
        async with create_sessionmaker(engine)() as session:
            fields = await fields_repo.list_fields(session, table_id=uuid.UUID(board.id))
            for record in (await session.execute(select(Record))).scalars():
                rows = (
                    await session.execute(
                        select(RecordViewer).where(RecordViewer.record_id == record.id)
                    )
                ).scalars()
                actual = {(row.user_id, row.source_key) for row in rows}
                assert actual == set(wanted_viewers(record, fields))
    finally:
        await engine.dispose()
