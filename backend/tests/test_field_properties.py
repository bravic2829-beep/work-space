"""The shared column properties (unique, default, description), the limits of text and number,
the formats of text, and the colors of options. Through the API, with a database."""

import json
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.work_world import Work


class Sheet:
    def __init__(self, work: Work, table: dict[str, Any]) -> None:
        self.work = work
        self.id: str = table["id"]
        self.name_id: str = table["fields"][0]["id"]

    async def column(self, name: str, kind: str, **extra: Any) -> dict[str, Any]:
        return await self.work.make_field(self.id, name, kind, **extra)

    async def post(self, cells: dict[str, Any], who: str = "admin") -> Any:
        return await self.work.api(
            "POST", f"/tables/{self.id}/records", who, json={"data": {self.name_id: "T", **cells}}
        )

    async def create(self, cells: dict[str, Any]) -> dict[str, Any]:
        response = await self.post(cells)
        assert response.status_code == 201, response.text
        body: dict[str, Any] = response.json()
        return body

    async def patch(self, record: dict[str, Any], cells: dict[str, Any]) -> Any:
        return await self.work.api(
            "PATCH",
            f"/records/{record['id']}",
            json={"data": cells},
            headers={"If-Match": f'"{record["version"]}"'},
        )

    async def update(self, field: dict[str, Any], **changes: Any) -> Any:
        return await self.work.api("PATCH", f"/fields/{field['id']}", json=changes)


@pytest.fixture
async def sheet(work: Work) -> Sheet:
    base_id = await work.make_base()
    return Sheet(work, await work.make_table(base_id, "Test"))


# --- description ------------------------------------------------------------------------------


async def test_a_column_has_an_optional_description(sheet: Sheet) -> None:
    plain = await sheet.column("Plain", "text")
    assert plain["description"] is None
    hinted = await sheet.column("Hinted", "number", description="  Units sold  ")
    assert hinted["description"] == "Units sold"  # trimmed

    changed = await sheet.update(hinted, description="Units sold per day")
    assert changed.json()["description"] == "Units sold per day"
    cleared = await sheet.update(hinted, description="   ")
    assert cleared.json()["description"] is None
    listed = await sheet.work.api("GET", f"/tables/{sheet.id}/fields")
    assert {f["name"]: f["description"] for f in listed.json()}["Hinted"] is None


async def test_a_long_description_is_refused(sheet: Sheet) -> None:
    response = await sheet.work.api(
        "POST",
        f"/tables/{sheet.id}/fields",
        json={"name": "X", "type": "text", "description": "x" * 501},
    )
    assert_problem(response, 422)


async def test_only_an_editor_changes_the_description(sheet: Sheet) -> None:
    field = await sheet.column("A", "text")
    for who in ("viewer", "commenter"):
        response = await sheet.work.api(
            "PATCH", f"/fields/{field['id']}", who, json={"description": "x"}
        )
        assert_problem(response, 403)


# --- default ----------------------------------------------------------------------------------


async def test_a_new_record_gets_the_default_of_a_column(sheet: Sheet) -> None:
    text = await sheet.column("Source", "text", default="web")
    num = await sheet.column("Qty", "number", config={"precision": 0}, default=1)
    tick = await sheet.column("Paid", "checkbox", default=False)
    day = await sheet.column("Day", "date", default="2026-01-01")
    pick = await sheet.column("Size", "select", config={"options": [{"name": "S"}, {"name": "M"}]})
    medium = pick["config"]["options"][1]["id"]
    await sheet.update(pick, default=[medium])

    record = await sheet.create({})
    data = record["data"]
    assert data[text["id"]] == "web"
    assert data[num["id"]] == 1
    assert data[tick["id"]] is False
    assert data[day["id"]] == "2026-01-01"
    assert data[pick["id"]] == [medium]

    # A value the person gives wins, and so does an explicit "empty" for the others.
    given = await sheet.create({text["id"]: "phone", num["id"]: 5})
    assert given["data"][text["id"]] == "phone" and given["data"][num["id"]] == 5

    # The default is for new records only.
    older = await sheet.work.api("GET", f"/records/{record['id']}")
    assert older.json()["data"][text["id"]] == "web"
    await sheet.update(text, default=None)
    again = await sheet.create({})
    assert text["id"] not in again["data"]


async def test_a_default_that_does_not_fit_is_refused(sheet: Sheet) -> None:
    bad: list[dict[str, Any]] = [
        {"name": "A", "type": "number", "config": {"max": 5}, "default": 9},
        {"name": "B", "type": "text", "config": {"format": "email"}, "default": "nope"},
        {"name": "C", "type": "checkbox", "default": "yes"},
        {"name": "D", "type": "user", "default": []},
        {"name": "E", "type": "timer", "default": {}},
        {"name": "F", "type": "select", "config": {"options": []}, "default": ["zzz"]},
        {"name": "G", "type": "date", "default": "13/11/2026"},
    ]
    for body in bad:
        response = await sheet.work.api("POST", f"/tables/{sheet.id}/fields", json=body)
        assert_problem(response, 422)


async def test_a_default_that_no_longer_fits_blocks_the_change_of_config(sheet: Sheet) -> None:
    field = await sheet.column("Qty", "number", config={"precision": 0}, default=50)
    response = await sheet.update(field, config={"precision": 0, "max": 10})
    # Nothing holds 50 yet, but the default is 50: it must be changed together with the limit.
    assert_problem(response, 409)
    both = await sheet.update(field, config={"precision": 0, "max": 10}, default=5)
    assert both.status_code == 200, both.text
    assert both.json()["default"] == 5


async def test_a_default_is_dropped_when_the_type_changes(sheet: Sheet) -> None:
    field = await sheet.column("Code", "text", default="7")
    response = await sheet.update(field, type="number")
    assert response.status_code == 200, response.text
    assert response.json()["default"] is None


async def test_a_required_column_with_a_default_is_filled_on_creation(sheet: Sheet) -> None:
    await sheet.column("Channel", "text", is_required=True, default="web")
    # Required means a value must exist; the default is one.
    assert (await sheet.post({})).status_code == 201


# --- unique -----------------------------------------------------------------------------------


async def test_a_unique_column_refuses_a_second_record_with_the_same_value(sheet: Sheet) -> None:
    sku = await sheet.column("SKU", "text", unique=True)
    assert sku["unique"] is True
    await sheet.create({sku["id"]: "A-1"})
    duplicate = await sheet.post({sku["id"]: "A-1"})
    body = assert_problem(duplicate, 422)
    assert body["errors"] == [
        {"field": sku["id"], "message": "Another record already has this value."}
    ]
    assert (await sheet.post({sku["id"]: "A-2"})).status_code == 201
    # Different case is a different value (text is compared as it is written).
    assert (await sheet.post({sku["id"]: "a-1"})).status_code == 201
    # Records without a value do not collide.
    assert (await sheet.post({})).status_code == 201
    assert (await sheet.post({})).status_code == 201


async def test_a_unique_number(sheet: Sheet) -> None:
    code = await sheet.column("Code", "number", unique=True)
    await sheet.create({code["id"]: 7})
    assert_problem(await sheet.post({code["id"]: 7}), 422)
    assert (await sheet.post({code["id"]: 8})).status_code == 201


async def test_changing_a_record_to_a_taken_value_is_refused(sheet: Sheet) -> None:
    sku = await sheet.column("SKU", "text", unique=True)
    first = await sheet.create({sku["id"]: "A"})
    second = await sheet.create({sku["id"]: "B"})
    assert_problem(await sheet.patch(second, {sku["id"]: "A"}), 422)
    # Saving the value a record already has is not a clash with itself.
    same = await sheet.patch(first, {sku["id"]: "A"})
    assert same.status_code == 200, same.text
    free = await sheet.patch(second, {sku["id"]: "C"})
    assert free.status_code == 200, free.text


async def test_a_deleted_records_value_is_free_again(sheet: Sheet) -> None:
    sku = await sheet.column("SKU", "text", unique=True)
    first = await sheet.create({sku["id"]: "A"})
    deleted = await sheet.work.api(
        "DELETE", f"/records/{first['id']}", headers={"If-Match": f'"{first["version"]}"'}
    )
    assert deleted.status_code == 204, deleted.text
    assert (await sheet.post({sku["id"]: "A"})).status_code == 201


async def test_a_column_cannot_become_unique_while_two_records_share_a_value(
    sheet: Sheet,
) -> None:
    sku = await sheet.column("SKU", "text")
    await sheet.create({sku["id"]: "A"})
    await sheet.create({sku["id"]: "A"})
    await sheet.create({sku["id"]: "B"})
    body = assert_problem(await sheet.update(sku, unique=True), 409)
    assert "1 value(s)" in str(body["detail"])
    fresh = await sheet.column("Other", "text")
    await sheet.create({fresh["id"]: "x"})
    assert (await sheet.update(fresh, unique=True)).json()["unique"] is True
    assert (await sheet.update(fresh, unique=False)).json()["unique"] is False


async def test_only_text_and_number_can_be_unique(sheet: Sheet) -> None:
    for kind in ("long_text", "date", "checkbox", "user", "timer"):
        response = await sheet.work.api(
            "POST", f"/tables/{sheet.id}/fields", json={"name": kind, "type": kind, "unique": True}
        )
        assert_problem(response, 422)


async def test_two_writers_cannot_both_take_the_same_value(sheet: Sheet) -> None:
    import asyncio

    sku = await sheet.column("SKU", "text", unique=True)
    results = await asyncio.gather(*(sheet.post({sku["id"]: "RACE"}) for _ in range(6)))
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 422, 422, 422, 422, 422], codes


# --- required ---------------------------------------------------------------------------------


async def test_a_checkbox_cannot_be_required(sheet: Sheet) -> None:
    response = await sheet.work.api(
        "POST",
        f"/tables/{sheet.id}/fields",
        json={"name": "Tick", "type": "checkbox", "is_required": True},
    )
    assert_problem(response, 422)
    tick = await sheet.column("Tick", "checkbox")
    assert_problem(await sheet.update(tick, is_required=True), 422)


# --- limits and formats -----------------------------------------------------------------------


async def test_a_text_column_has_a_length_limit_and_a_format(sheet: Sheet) -> None:
    code = await sheet.column("Code", "text", config={"max_length": 5})
    assert code["config"] == {"max_length": 5}
    assert (await sheet.post({code["id"]: "12345"})).status_code == 201
    assert_problem(await sheet.post({code["id"]: "123456"}), 422)

    mail = await sheet.column("Mail", "text", config={"format": "email"})
    assert (await sheet.post({mail["id"]: " a@b.vn "})).status_code == 201
    record = await sheet.work.api("GET", f"/tables/{sheet.id}/records")
    assert any(r["data"].get(mail["id"]) == "a@b.vn" for r in record.json()["items"])
    assert_problem(await sheet.post({mail["id"]: "not an email"}), 422)

    link = await sheet.column("Link", "text", config={"format": "url"})
    assert_problem(await sheet.post({link["id"]: "javascript:alert(1)"}), 422)
    phone = await sheet.column("Phone", "text", config={"format": "phone"})
    assert (await sheet.post({phone["id"]: "+84 912 345 678"})).status_code == 201


async def test_a_text_limit_cannot_shrink_below_what_records_hold(sheet: Sheet) -> None:
    note = await sheet.column("Note", "text")
    await sheet.create({note["id"]: "x" * 40})
    await sheet.create({note["id"]: "short"})
    body = assert_problem(await sheet.update(note, config={"max_length": 20}), 409)
    assert "1 record(s)" in str(body["detail"])
    assert (await sheet.update(note, config={"max_length": 40})).status_code == 200


async def test_a_format_cannot_be_set_while_records_hold_something_else(sheet: Sheet) -> None:
    contact = await sheet.column("Contact", "text")
    await sheet.create({contact["id"]: "a@b.vn"})
    await sheet.create({contact["id"]: "call Mai"})
    await sheet.create({})  # no value: fine
    body = assert_problem(await sheet.update(contact, config={"format": "email"}), 409)
    assert "1 record(s)" in str(body["detail"])
    other = await sheet.column("Other", "text")
    await sheet.create({other["id"]: "a@b.vn"})
    assert (await sheet.update(other, config={"format": "email"})).status_code == 200


async def test_number_limits(sheet: Sheet) -> None:
    pct = await sheet.column("Done", "number", config={"min": 0, "max": 100, "format": "percent"})
    assert pct["config"] == {"precision": 0, "min": 0, "max": 100, "format": "percent"}
    assert (await sheet.post({pct["id"]: 100})).status_code == 201
    assert_problem(await sheet.post({pct["id"]: 101}), 422)
    assert_problem(await sheet.post({pct["id"]: -1}), 422)
    money = await sheet.column("Price", "number", config={"format": "currency"})
    assert money["config"]["currency"] == "VND"


async def test_number_limits_cannot_contradict_the_records(sheet: Sheet) -> None:
    qty = await sheet.column("Qty", "number")
    await sheet.create({qty["id"]: 3})
    await sheet.create({qty["id"]: 50})
    body = assert_problem(await sheet.update(qty, config={"precision": 0, "max": 10}), 409)
    assert "1 record(s)" in str(body["detail"])
    assert_problem(await sheet.update(qty, config={"precision": 0, "min": 10}), 409)
    assert (
        await sheet.update(qty, config={"precision": 0, "min": 1, "max": 99})
    ).status_code == 200


# --- selects and colors -----------------------------------------------------------------------


async def test_a_select_cell_is_always_a_list(sheet: Sheet) -> None:
    size = await sheet.column("Size", "select", config={"options": [{"name": "S"}, {"name": "M"}]})
    assert size["config"]["multiple"] is False
    s, m = (o["id"] for o in size["config"]["options"])
    assert (await sheet.post({size["id"]: [s]})).status_code == 201
    assert_problem(await sheet.post({size["id"]: s}), 422)  # a bare id is not a list
    assert_problem(await sheet.post({size["id"]: [s, m]}), 422)  # one only
    tags = await sheet.column(
        "Tags", "select", config={"options": [{"name": "x"}, {"name": "y"}], "multiple": True}
    )
    x, y = (o["id"] for o in tags["config"]["options"])
    created = await sheet.create({tags["id"]: [x, y, x]})
    assert created["data"][tags["id"]] == [x, y]


async def test_option_colors(sheet: Sheet) -> None:
    pick = await sheet.column(
        "Pick",
        "select",
        config={
            "options": [{"name": "A"}, {"name": "B", "color": "#FF8800"}, {"name": "C"}],
        },
    )
    colors = [o["color"] for o in pick["config"]["options"]]
    assert colors == ["#e5484d", "#ff8800", "#f5a623"]  # B keeps its own, lower-cased
    bad = await sheet.work.api(
        "POST",
        f"/tables/{sheet.id}/fields",
        json={
            "name": "Bad",
            "type": "select",
            "config": {"options": [{"name": "A", "color": "red; drop table"}]},
        },
    )
    assert_problem(bad, 422)

    # A color can be changed later, and a new option gets one.
    a = pick["config"]["options"][0]
    changed = await sheet.update(
        pick,
        config={
            "options": [
                {"id": a["id"], "name": "A", "color": "#000000"},
                *[
                    {"id": o["id"], "name": o["name"], "color": o["color"]}
                    for o in pick["config"]["options"][1:]
                ],
                {"name": "D"},
            ]
        },
    )
    assert changed.status_code == 200, changed.text
    options = changed.json()["config"]["options"]
    assert options[0]["color"] == "#000000"
    assert options[3]["color"] == "#f5a623" or options[3]["color"].startswith("#")


async def test_status_options_have_the_color_of_their_kind(sheet: Sheet) -> None:
    status = await sheet.column("State", "status")
    by_kind = {o["kind"]: o["color"] for o in status["config"]["options"]}
    assert by_kind == {
        "todo": "#8b97a3",
        "in_progress": "#3e63dd",
        "review": "#f5a623",
        "done": "#46a758",
        "paused": "#6e56cf",
        "blocked": "#e5484d",
    }


# --- the old things are gone ------------------------------------------------------------------


@pytest.mark.parametrize("old", ["single_select", "multi_select", "url"])
async def test_the_removed_types_cannot_be_made(sheet: Sheet, old: str) -> None:
    response = await sheet.work.api(
        "POST", f"/tables/{sheet.id}/fields", json={"name": "Old", "type": old}
    )
    assert_problem(response, 422)


async def test_a_date_column_has_no_fill_any_more(sheet: Sheet) -> None:
    response = await sheet.work.api(
        "POST",
        f"/tables/{sheet.id}/fields",
        json={"name": "D", "type": "date", "config": {"fill": "created"}},
    )
    assert_problem(response, 422)
    made = await sheet.column("Made", "created_time")
    record = await sheet.create({})
    assert record["data"][made["id"]].startswith("20")  # filled by the system


async def test_the_json_of_a_field_lists_the_new_properties(sheet: Sheet) -> None:
    field = await sheet.column("X", "text")
    assert {"unique", "default", "description"} <= set(field)
    assert json.dumps(field)  # plain JSON
