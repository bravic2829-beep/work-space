"""A date column is picked by hand, or filled when the record is created."""

from datetime import UTC, date, datetime
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.work_world import Work


class Sheet:
    def __init__(self, work: Work, table: dict[str, Any]) -> None:
        self.work = work
        self.id: str = table["id"]
        self.name_id: str = table["fields"][0]["id"]

    async def date_field(self, name: str = "Date", **config: Any) -> dict[str, Any]:
        return await self.work.make_field(self.id, name, "date", config=config)

    async def create(self, **cells: Any) -> dict[str, Any]:
        response = await self.work.api(
            "POST", f"/tables/{self.id}/records", json={"data": {self.name_id: "Task", **cells}}
        )
        assert response.status_code == 201, response.text
        body: dict[str, Any] = response.json()
        return body


@pytest.fixture
async def sheet(work: Work) -> Sheet:
    base_id = await work.make_base()
    return Sheet(work, await work.make_table(base_id, "Test"))


def today() -> str:
    return datetime.now(UTC).date().isoformat()


async def test_the_default_is_to_pick_the_date(sheet: Sheet) -> None:
    field = await sheet.date_field()
    assert field["config"] == {"include_time": False}
    record = await sheet.create()
    assert field["id"] not in record["data"]


async def test_a_created_date_is_filled_when_the_record_is_made(sheet: Sheet) -> None:
    field = await sheet.date_field(fill="created")
    assert field["config"] == {"include_time": False, "fill": "created"}
    record = await sheet.create()
    assert record["data"][field["id"]] == today()


async def test_a_value_the_person_gives_is_kept(sheet: Sheet) -> None:
    field = await sheet.date_field(fill="created")
    record = await sheet.create(**{field["id"]: "2026-01-02"})
    assert record["data"][field["id"]] == "2026-01-02"


async def test_a_created_date_with_a_time_is_the_exact_moment(sheet: Sheet) -> None:
    field = await sheet.date_field(include_time=True, fill="created")
    before = datetime.now(UTC).replace(microsecond=0)
    record = await sheet.create()
    stamp = datetime.fromisoformat(record["data"][field["id"]].replace("Z", "+00:00"))
    assert record["data"][field["id"]].endswith("Z")
    assert before <= stamp <= datetime.now(UTC)


async def test_the_filled_date_can_be_changed_afterwards(sheet: Sheet) -> None:
    field = await sheet.date_field(fill="created")
    record = await sheet.create()
    response = await sheet.work.api(
        "PATCH",
        f"/records/{record['id']}",
        json={"data": {field["id"]: "2026-03-04"}},
        headers={"If-Match": f'"{record["version"]}"'},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"][field["id"]] == "2026-03-04"


async def test_switching_a_column_to_created_only_affects_new_records(sheet: Sheet) -> None:
    field = await sheet.date_field()
    old = await sheet.create()
    response = await sheet.work.api(
        "PATCH",
        f"/fields/{field['id']}",
        json={"config": {"include_time": False, "fill": "created"}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["config"] == {"include_time": False, "fill": "created"}
    new = await sheet.create()
    assert new["data"][field["id"]] == today()
    again = await sheet.work.api("GET", f"/records/{old['id']}")
    assert field["id"] not in again.json()["data"]  # what was already there is left alone


async def test_switching_back_to_picking_stops_the_filling(sheet: Sheet) -> None:
    field = await sheet.date_field(fill="created")
    response = await sheet.work.api(
        "PATCH", f"/fields/{field['id']}", json={"config": {"include_time": False}}
    )
    assert response.status_code == 200, response.text
    assert response.json()["config"] == {"include_time": False}
    assert field["id"] not in (await sheet.create())["data"]


async def test_an_unknown_fill_is_refused(sheet: Sheet) -> None:
    response = await sheet.work.api(
        "POST",
        f"/tables/{sheet.id}/fields",
        json={"name": "D", "type": "date", "config": {"fill": "tomorrow"}},
    )
    assert_problem(response, 422)


async def test_only_a_date_column_takes_the_option(sheet: Sheet) -> None:
    response = await sheet.work.api(
        "POST",
        f"/tables/{sheet.id}/fields",
        json={"name": "T", "type": "text", "config": {"fill": "created"}},
    )
    assert_problem(response, 422)


async def test_the_date_of_today_is_a_real_date(sheet: Sheet) -> None:
    field = await sheet.date_field(fill="created")
    record = await sheet.create()
    assert date.fromisoformat(record["data"][field["id"]]) == datetime.now(UTC).date()
