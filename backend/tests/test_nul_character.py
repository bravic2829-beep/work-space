"""PostgreSQL cannot store the NUL character in text. Every API must answer 422 for it."""

import json

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.work_world import Work

NUL = chr(0)


async def test_names_with_a_nul_character_are_a_422(work: Work) -> None:
    base_id = await work.make_base()
    table = await work.make_table(base_id, "Notes")
    bad = f"a{NUL}b"
    assert_problem(await work.api("POST", "/workspaces", json={"name": bad}), 422)
    assert_problem(
        await work.api("POST", f"/workspaces/{work.workspace_id}/bases", json={"name": bad}), 422
    )
    assert_problem(await work.api("POST", f"/bases/{base_id}/tables", json={"name": bad}), 422)
    field = {"name": bad, "type": "text"}
    assert_problem(await work.api("POST", f"/tables/{table['id']}/fields", json=field), 422)
    view = {"name": bad}
    assert_problem(await work.api("POST", f"/tables/{table['id']}/views", json=view), 422)
    assert_problem(await work.api("GET", "/directory/users", params={"q": bad}), 422)


async def test_values_with_a_nul_character_are_a_422(work: Work) -> None:
    table = await work.make_table(await work.make_base(), "Notes")
    long = await work.make_field(table["id"], "Long", "long_text")
    pick = {"name": "Pick", "type": "single_select", "config": {"options": [{"name": f"a{NUL}"}]}}
    assert_problem(await work.api("POST", f"/tables/{table['id']}/fields", json=pick), 422)
    name_field = table["fields"][0]["id"]
    for field_id in (name_field, long["id"]):
        response = await work.api(
            "POST", f"/tables/{table['id']}/records", json={"data": {field_id: f"x{NUL}y"}}
        )
        assert_problem(response, 422)
    url = f"/tables/{table['id']}/records"
    assert (await work.api("GET", url)).status_code == 200  # the table is fine afterwards


async def test_a_nul_character_in_a_filter_is_a_422(work: Work) -> None:
    board = Board(work, await work.make_table(await work.make_base(), "T"))
    # json.dumps writes the NUL character as the six characters backslash-u-0-0-0-0.
    condition = json.dumps([{"field": board.f["Name"], "op": "contains", "value": f"a{NUL}b"}])
    assert "u0000" in condition
    response = await work.api("GET", f"/tables/{board.id}/records", params={"filter": condition})
    assert_problem(response, 422)
