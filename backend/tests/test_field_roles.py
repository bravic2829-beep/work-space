"""Giving a role to a column that already exists (a People column made without one)."""

from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.work_world import Work


class Sheet:
    """A blank table with a People column that has no role, and one record naming `member`."""

    def __init__(self, work: Work, table: dict[str, Any], people: dict[str, Any]) -> None:
        self.work = work
        self.table_id: str = table["id"]
        self.name_id: str = table["fields"][0]["id"]
        self.people_id: str = people["id"]
        self.record: dict[str, Any] = {}

    async def make_record(self) -> None:
        response = await self.work.api(
            "POST",
            f"/tables/{self.table_id}/records",
            json={
                "data": {
                    self.name_id: "Test",
                    self.people_id: [str(self.work.users["member"])],
                }
            },
        )
        assert response.status_code == 201, response.text
        self.record = response.json()

    async def set_role(self, field_id: str, role: str | None, who: str = "admin") -> Any:
        return await self.work.api("PATCH", f"/fields/{field_id}", who, json={"semantic": role})

    async def my_tasks(self, who: str = "member") -> list[str]:
        response = await self.work.api("GET", "/me/tasks", who, params={"scope": "assigned"})
        assert response.status_code == 200, response.text
        return [item["name"] for item in response.json()["items"]]


@pytest.fixture
async def sheet(work: Work) -> Sheet:
    base_id = await work.make_base()
    table = await work.make_table(base_id, "Test")
    people = await work.make_field(table["id"], "Assign", "user")
    made = Sheet(work, table, people)
    await made.make_record()
    return made


async def test_a_people_column_without_a_role_does_nothing(sheet: Sheet) -> None:
    # This is what happened: the person is named, but sees nothing and is not told.
    assert await sheet.my_tasks() == []
    assert_problem(await sheet.work.api("GET", f"/records/{sheet.record['id']}", "member"), 403)
    assert (await sheet.work.api("GET", "/notifications", "member")).json()["items"] == []


async def test_giving_it_the_assignee_role_makes_the_task_theirs(sheet: Sheet) -> None:
    response = await sheet.set_role(sheet.people_id, "assignee")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["semantic"], body["grants_view"]) == ("assignee", True)

    # The task they were already named in shows up, and they can open it.
    assert await sheet.my_tasks() == ["Test"]
    opened = await sheet.work.api("GET", f"/records/{sheet.record['id']}", "member")
    assert opened.status_code == 200
    # The role also works for what is assigned from now on.
    created = await sheet.work.api(
        "POST",
        f"/tables/{sheet.table_id}/records",
        json={"data": {sheet.name_id: "Next", sheet.people_id: [str(sheet.work.users["member"])]}},
    )
    assert created.status_code == 201, created.text
    assert sorted(await sheet.my_tasks()) == ["Next", "Test"]
    assert len((await sheet.work.api("GET", "/notifications", "member")).json()["items"]) == 1


async def test_the_follower_role_lets_them_open_it_without_making_it_theirs(
    sheet: Sheet,
) -> None:
    assert (await sheet.set_role(sheet.people_id, "follower")).status_code == 200
    opened = await sheet.work.api("GET", f"/records/{sheet.record['id']}", "member")
    assert opened.status_code == 200
    assert await sheet.my_tasks() == []


async def test_taking_the_role_away_takes_the_access_with_it(sheet: Sheet) -> None:
    await sheet.set_role(sheet.people_id, "assignee")
    assert await sheet.my_tasks() == ["Test"]

    response = await sheet.set_role(sheet.people_id, None)
    assert response.status_code == 200, response.text
    assert (response.json()["semantic"], response.json()["grants_view"]) == (None, False)
    assert await sheet.my_tasks() == []
    assert_problem(await sheet.work.api("GET", f"/records/{sheet.record['id']}", "member"), 403)


async def test_a_table_has_one_assignee_column(sheet: Sheet) -> None:
    other = await sheet.work.make_field(sheet.table_id, "Reviewer", "user")
    assert (await sheet.set_role(sheet.people_id, "assignee")).status_code == 200
    assert_problem(await sheet.set_role(other["id"], "assignee"), 409)
    # Setting the role it already has changes nothing and is not an error.
    assert (await sheet.set_role(sheet.people_id, "assignee")).status_code == 200


async def test_a_role_must_fit_the_type_of_the_column(sheet: Sheet) -> None:
    assert_problem(await sheet.set_role(sheet.name_id, "assignee"), 422)
    assert_problem(await sheet.set_role(sheet.people_id, "status"), 422)
    assert_problem(await sheet.set_role(sheet.people_id, "parent"), 422)


async def test_only_an_editor_can_give_a_role(sheet: Sheet) -> None:
    for who in ("viewer", "commenter", "member"):
        assert_problem(await sheet.set_role(sheet.people_id, "assignee", who), 403)
    assert_problem(await sheet.set_role(sheet.people_id, "assignee", "other_admin"), 404)
    assert (await sheet.set_role(sheet.people_id, "assignee", "editor")).status_code == 200


async def test_an_unknown_role_is_refused(sheet: Sheet) -> None:
    assert_problem(await sheet.set_role(sheet.people_id, "boss"), 422)
