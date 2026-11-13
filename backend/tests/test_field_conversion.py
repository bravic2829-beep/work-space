import json
import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem, db_execute, db_fetch
from tests.work_world import Work


class Sheet:
    """A blank table with a column to convert, and helpers to put values in it."""

    def __init__(self, work: Work, table: dict[str, Any]) -> None:
        self.work = work
        self.table = table
        self.id: str = table["id"]
        self.name_field: str = table["fields"][0]["id"]
        self.field: dict[str, Any] = {}

    async def column(self, field_type: str, name: str = "Value", **extra: Any) -> dict[str, Any]:
        self.field = await self.work.make_field(self.id, name, field_type, **extra)
        return self.field

    async def add(self, *values: Any) -> list[dict[str, Any]]:
        made = []
        for value in values:
            data: dict[str, Any] = {} if value is None else {self.field["id"]: value}
            response = await self.work.api(
                "POST", f"/tables/{self.id}/records", json={"data": data}
            )
            assert response.status_code == 201, response.text
            made.append(response.json())
        return made

    async def convert(self, new_type: str, config: dict[str, Any] | None = None) -> Any:
        body: dict[str, Any] = {"type": new_type}
        if config is not None:
            body["config"] = config
        return await self.work.api("PATCH", f"/fields/{self.field['id']}", json=body)

    async def values(self) -> list[Any]:
        """The value of the column of every record, in creation order (None when empty)."""
        response = await self.work.api("GET", f"/tables/{self.id}/records")
        items = response.json()["items"]
        return [item["data"].get(self.field["id"]) for item in items]

    async def versions(self) -> list[int]:
        response = await self.work.api("GET", f"/tables/{self.id}/records")
        return [item["version"] for item in response.json()["items"]]


@pytest.fixture
async def sheet(work: Work) -> Sheet:
    base_id = await work.make_base()
    return Sheet(work, await work.make_table(base_id, "Sheet"))


# --- what converts into what -----------------------------------------------------------------


async def test_text_becomes_number(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("1", "2.5", "  3 ", "", None, "-4")
    response = await sheet.convert("number", {"precision": 1})
    assert response.status_code == 200, response.text
    assert response.json()["type"] == "number"
    assert response.json()["config"] == {"precision": 1}
    assert await sheet.values() == [1.0, 2.5, 3.0, None, None, -4.0]


async def test_a_value_that_does_not_convert_stops_the_change_and_changes_nothing(
    sheet: Sheet, migrated_database_url: str
) -> None:
    await sheet.column("text")
    await sheet.add("1", "2", "twelve", "3", "4x")
    versions_before = await sheet.versions()
    response = await sheet.convert("number")
    body = assert_problem(response, 409)
    assert "2 record(s)" in str(body["detail"])
    errors: list[dict[str, str]] = body["errors"]  # type: ignore[assignment]
    assert len(errors) == 2
    uuid.UUID(errors[0]["field"])  # the field of an error is the record that cannot convert
    assert errors[0]["message"]
    # Neither the column nor any value changed, not even the ones that could convert.
    assert (await sheet.work.api("GET", f"/fields/{sheet.field['id']}")).json()["type"] == "text"
    assert await sheet.values() == ["1", "2", "twelve", "3", "4x"]
    assert await sheet.versions() == versions_before
    rows = await db_fetch(migrated_database_url, "SELECT data FROM records ORDER BY created_at")
    stored = [json.loads(r["data"]).get(sheet.field["id"]) for r in rows]
    assert stored == ["1", "2", "twelve", "3", "4x"]


async def test_only_a_few_failures_are_listed(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add(*["bad"] * 9)
    body = assert_problem(await sheet.convert("number"), 409)
    assert "9 record(s)" in str(body["detail"])
    assert len(body["errors"]) == 5  # type: ignore[arg-type]


async def test_text_becomes_date(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("2026-11-13", " 2026-01-02 ", None)
    response = await sheet.convert("date")
    assert response.status_code == 200, response.text
    assert await sheet.values() == ["2026-11-13", "2026-01-02", None]


async def test_text_that_is_not_a_date_blocks_the_change(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("2026-11-13", "next week")
    assert_problem(await sheet.convert("date"), 409)


async def test_text_becomes_a_single_choice_by_matching_option_names(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("Open", "closed", " OPEN ", "", None)
    # The options must be given: they are what the texts are matched against.
    assert_problem(await sheet.convert("single_select"), 422)
    options = {"options": [{"name": "Open"}, {"name": "Closed"}]}
    response = await sheet.convert("single_select", options)
    assert response.status_code == 200, response.text
    ids = {o["name"]: o["id"] for o in response.json()["config"]["options"]}
    assert await sheet.values() == [ids["Open"], ids["Closed"], ids["Open"], None, None]


async def test_a_text_without_a_matching_option_blocks_the_change(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("Open", "Pending")
    options = {"options": [{"name": "Open"}, {"name": "Closed"}]}
    assert_problem(await sheet.convert("single_select", options), 409)
    assert (await sheet.work.api("GET", f"/fields/{sheet.field['id']}")).json()["type"] == "text"


async def test_number_and_date_become_text(sheet: Sheet) -> None:
    await sheet.column("number", config={"precision": 2})
    await sheet.add(3.5, 7, None)
    assert (await sheet.convert("text")).status_code == 200
    assert await sheet.values() == ["3.50", "7.00", None]

    other = await sheet.work.make_table(await sheet.work.make_base("Second"), "Dates")
    dates = Sheet(sheet.work, other)
    await dates.column("date")
    await dates.add("2026-11-13")
    assert (await dates.convert("long_text")).status_code == 200
    assert await dates.values() == ["2026-11-13"]


async def test_long_text_becomes_text_only_when_short_enough(sheet: Sheet) -> None:
    await sheet.column("long_text")
    await sheet.add("short", "x" * 1000)
    assert (await sheet.convert("text")).status_code == 200
    other = await sheet.work.make_table(await sheet.work.make_base("Second"), "Long")
    longer = Sheet(sheet.work, other)
    await longer.column("long_text")
    await longer.add("short", "x" * 1001)
    assert_problem(await longer.convert("text"), 409)


async def test_text_becomes_long_text_and_back(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("hello")
    assert (await sheet.convert("long_text")).status_code == 200
    assert (await sheet.convert("text")).status_code == 200
    assert await sheet.values() == ["hello"]


async def test_single_choice_becomes_multiple_choice_and_back(sheet: Sheet) -> None:
    field = await sheet.column("single_select", config={"options": [{"name": "A"}, {"name": "B"}]})
    a, b = (o["id"] for o in field["config"]["options"])
    await sheet.add(a, b, None)
    response = await sheet.convert("multi_select")
    assert response.status_code == 200, response.text
    assert [o["id"] for o in response.json()["config"]["options"]] == [a, b]  # ids are kept
    assert await sheet.values() == [[a], [b], None]
    back = await sheet.convert("single_select")
    assert back.status_code == 200, back.text
    assert await sheet.values() == [a, b, None]


async def test_multiple_choices_with_two_values_cannot_become_a_single_choice(
    sheet: Sheet,
) -> None:
    field = await sheet.column("multi_select", config={"options": [{"name": "A"}, {"name": "B"}]})
    a, b = (o["id"] for o in field["config"]["options"])
    await sheet.add([a], [], [a, b])
    assert_problem(await sheet.convert("single_select"), 409)
    assert await sheet.values() == [[a], [], [a, b]]


async def test_multiple_choices_become_text_joined_by_commas(sheet: Sheet) -> None:
    field = await sheet.column("multi_select", config={"options": [{"name": "A"}, {"name": "B"}]})
    a, b = (o["id"] for o in field["config"]["options"])
    await sheet.add([a, b], [b], [])
    assert (await sheet.convert("text")).status_code == 200
    assert await sheet.values() == ["A, B", "B", None]


async def test_single_choice_and_status_convert_both_ways_keeping_ids(sheet: Sheet) -> None:
    field = await sheet.column(
        "single_select", config={"options": [{"name": "Open"}, {"name": "Shut"}]}
    )
    open_id = field["config"]["options"][0]["id"]
    await sheet.add(open_id)
    status = await sheet.convert("status")
    assert status.status_code == 200, status.text
    assert [o["kind"] for o in status.json()["config"]["options"]] == ["todo", "todo"]
    assert status.json()["config"]["options"][0]["id"] == open_id
    assert await sheet.values() == [open_id]
    plain = await sheet.convert("single_select")
    assert plain.status_code == 200, plain.text
    assert all("kind" not in o for o in plain.json()["config"]["options"])
    assert await sheet.values() == [open_id]


async def test_status_becomes_text(sheet: Sheet) -> None:
    field = await sheet.column("status")
    done = field["config"]["options"][3]
    await sheet.add(done["id"])
    assert (await sheet.convert("text")).status_code == 200
    assert await sheet.values() == ["Done"]


async def test_records_in_the_trash_are_converted_too(
    sheet: Sheet, migrated_database_url: str
) -> None:
    await sheet.column("text")
    (gone,) = await sheet.add("7")
    await sheet.work.api("DELETE", f"/records/{gone['id']}")
    assert (await sheet.convert("number")).status_code == 200
    rows = await db_fetch(migrated_database_url, "SELECT data, version FROM records")
    assert json.loads(rows[0]["data"])[sheet.field["id"]] == 7
    assert rows[0]["version"] == 3  # created, deleted, converted


async def test_the_version_of_converted_records_goes_up(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("1", None)
    before = await sheet.versions()
    await sheet.convert("number")
    after = await sheet.versions()
    assert after[0] == before[0] + 1  # a client holding the old version must reload
    assert after[1] == before[1]  # nothing to convert in an empty cell


async def test_a_big_table_is_converted_in_chunks(sheet: Sheet, migrated_database_url: str) -> None:
    await sheet.column("text")
    creator = (await db_fetch(migrated_database_url, "SELECT id FROM users LIMIT 1"))[0]["id"]
    await db_execute(
        migrated_database_url,
        "INSERT INTO records (table_id, data, created_by) "
        "SELECT $1, jsonb_build_object($2::text, g::text), $3 FROM generate_series(1, 2500) g",
        uuid.UUID(sheet.id),
        sheet.field["id"],
        creator,
    )
    response = await sheet.convert("number")
    assert response.status_code == 200, response.text
    rows = await db_fetch(
        migrated_database_url,
        "SELECT count(*) AS n, sum((data ->> $1)::numeric) AS total, "
        "       count(*) FILTER (WHERE jsonb_typeof(data -> $1) = 'number') AS numbers "
        "FROM records",
        sheet.field["id"],
    )
    assert rows[0]["n"] == 2500
    assert rows[0]["numbers"] == 2500
    assert rows[0]["total"] == 2500 * 2501 // 2


# --- what must not convert -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("text", "checkbox"),
        ("text", "multi_select"),
        ("text", "status"),
        ("text", "user"),
        ("long_text", "number"),
        ("long_text", "date"),
        ("number", "date"),
        ("number", "single_select"),
        ("date", "number"),
        ("checkbox", "text"),
        ("url", "text"),
        ("user", "text"),
        ("single_select", "number"),
        ("multi_select", "status"),
        ("created_by", "text"),
        ("created_time", "date"),
        ("auto_number", "number"),
    ],
)
async def test_unsupported_changes_are_rejected(sheet: Sheet, source: str, target: str) -> None:
    await sheet.column(source)
    assert_problem(await sheet.convert(target), 422)
    assert (await sheet.work.api("GET", f"/fields/{sheet.field['id']}")).json()["type"] == source


async def test_fields_with_a_role_keep_their_type(work: Work) -> None:
    table = await work.make_table(await work.make_base(), "Tasks", template="tasks")
    by_name = {f["name"]: f["id"] for f in table["fields"]}
    for name, target in (("Status", "single_select"), ("Assignee", "text"), ("Due date", "text")):
        response = await work.api("PATCH", f"/fields/{by_name[name]}", json={"type": target})
        assert_problem(response, 422)


async def test_link_fields_cannot_change_type(work: Work) -> None:
    table = await work.make_table(await work.make_base(), "Tasks", template="tasks")
    parent = next(f["id"] for f in table["fields"] if f["name"] == "Parent task")
    assert_problem(await work.api("PATCH", f"/fields/{parent}", json={"type": "text"}), 422)


async def test_only_editors_change_a_type(sheet: Sheet) -> None:
    await sheet.column("text")
    for who in ("viewer", "commenter", "member"):
        response = await sheet.work.api(
            "PATCH", f"/fields/{sheet.field['id']}", who, json={"type": "long_text"}
        )
        assert_problem(response, 403)
    ok = await sheet.work.api(
        "PATCH", f"/fields/{sheet.field['id']}", "editor", json={"type": "long_text"}
    )
    assert ok.status_code == 200


async def test_bad_config_for_the_new_type_is_rejected(sheet: Sheet) -> None:
    await sheet.column("text")
    await sheet.add("1")
    assert_problem(await sheet.convert("number", {"precision": 99}), 422)
    assert_problem(await sheet.convert("number", {"nonsense": True}), 422)
    assert_problem(await sheet.convert("long_text", {"precision": 2}), 422)


# --- changing the config when there is data --------------------------------------------------


async def test_an_option_that_records_use_cannot_be_removed(sheet: Sheet) -> None:
    field = await sheet.column(
        "single_select", config={"options": [{"name": "A"}, {"name": "B"}, {"name": "C"}]}
    )
    a, b, c = field["config"]["options"]
    await sheet.add(a["id"], a["id"], b["id"])
    url = f"/fields/{field['id']}"

    used = await sheet.work.api(
        "PATCH",
        url,
        json={"config": {"options": [{"id": b["id"], "name": "B"}, {"id": c["id"], "name": "C"}]}},
    )
    body = assert_problem(used, 409)
    assert "2 record(s)" in str(body["detail"])

    unused = await sheet.work.api(
        "PATCH",
        url,
        json={"config": {"options": [{"id": a["id"], "name": "A"}, {"id": b["id"], "name": "B"}]}},
    )
    assert unused.status_code == 200, unused.text
    renamed = await sheet.work.api(
        "PATCH",
        url,
        json={
            "config": {"options": [{"id": a["id"], "name": "Alpha"}, {"id": b["id"], "name": "B"}]}
        },
    )
    assert renamed.status_code == 200
    assert await sheet.values() == [a["id"], a["id"], b["id"]]


async def test_a_multiple_choice_option_in_use_cannot_be_removed(sheet: Sheet) -> None:
    field = await sheet.column("multi_select", config={"options": [{"name": "A"}, {"name": "B"}]})
    a, b = field["config"]["options"]
    await sheet.add([a["id"], b["id"]])
    response = await sheet.work.api(
        "PATCH",
        f"/fields/{field['id']}",
        json={"config": {"options": [{"id": a["id"], "name": "A"}]}},
    )
    assert_problem(response, 409)


async def test_dates_cannot_switch_between_date_and_time_while_records_hold_dates(
    sheet: Sheet,
) -> None:
    await sheet.column("date")
    url = f"/fields/{sheet.field['id']}"
    empty = await sheet.work.api("PATCH", url, json={"config": {"include_time": True}})
    assert empty.status_code == 200  # no records yet: nothing to contradict
    await sheet.work.api("PATCH", url, json={"config": {"include_time": False}})
    await sheet.add("2026-11-13")
    assert_problem(await sheet.work.api("PATCH", url, json={"config": {"include_time": True}}), 409)


async def test_a_user_field_cannot_become_single_while_a_record_has_two_people(
    sheet: Sheet,
) -> None:
    field = await sheet.column("user")
    url = f"/fields/{field['id']}"
    two = [str(sheet.work.users["viewer"]), str(sheet.work.users["editor"])]
    await sheet.add(two)
    assert_problem(await sheet.work.api("PATCH", url, json={"config": {"multiple": False}}), 409)
    one = await sheet.work.make_table(await sheet.work.make_base("Second"), "People")
    fresh = Sheet(sheet.work, one)
    other = await fresh.column("user")
    await fresh.add([two[0]])
    ok = await sheet.work.api(
        "PATCH", f"/fields/{other['id']}", json={"config": {"multiple": False}}
    )
    assert ok.status_code == 200
