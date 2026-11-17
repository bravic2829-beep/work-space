import uuid
from typing import Any

from tests.api_helpers import assert_problem, db_fetch
from tests.work_world import Work

MISSING = str(uuid.uuid4())


async def table_with_tasks(work: Work) -> dict[str, Any]:
    return await work.make_table(await work.make_base(), "Tasks", template="tasks")


async def blank_table(work: Work) -> dict[str, Any]:
    return await work.make_table(await work.make_base(), "Notes")


def field_url(table: dict[str, Any], suffix: str = "") -> str:
    return f"/tables/{table['id']}/fields{suffix}"


# --- creating fields -------------------------------------------------------------------------


async def test_create_a_field_of_every_simple_type(work: Work) -> None:
    table = await blank_table(work)
    cases: list[tuple[str, dict[str, Any], dict[str, Any]]] = [
        ("long_text", {}, {}),
        ("number", {}, {"precision": 0}),
        ("number", {"precision": 2}, {"precision": 2}),
        ("date", {}, {"include_time": False}),
        ("checkbox", {}, {}),
        ("url", {}, {}),
        ("user", {}, {"multiple": True}),
        ("created_by", {}, {}),
        ("created_time", {}, {}),
        ("auto_number", {}, {}),
    ]
    for index, (field_type, config, expected) in enumerate(cases):
        response = await work.api(
            "POST",
            field_url(table),
            "editor",
            json={"name": f"f{index}", "type": field_type, "config": config},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["type"] == field_type
        assert body["config"] == expected
        assert body["access"] == "edit"
        assert response.headers["location"] == f"/api/v1/fields/{body['id']}"


async def test_select_fields_get_ids_for_their_options(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(
        table["id"],
        "Priority",
        "single_select",
        config={"options": [{"name": "High", "color": "#ff0000"}, {"name": "Low"}]},
    )
    options = field["config"]["options"]
    assert [o["name"] for o in options] == ["High", "Low"]
    assert options[0]["color"] == "#ff0000"
    assert all(len(o["id"]) == 32 for o in options)
    assert options[0]["id"] != options[1]["id"]


async def test_status_field_defaults_to_the_four_states(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "State", "status", semantic="status")
    assert [o["kind"] for o in field["config"]["options"]] == [
        "todo",
        "in_progress",
        "review",
        "done",
    ]


async def test_only_editors_can_add_fields(work: Work) -> None:
    table = await blank_table(work)
    body = {"name": "X", "type": "text"}
    for who in ("viewer", "commenter", "member"):
        assert_problem(await work.api("POST", field_url(table), who, json=body), 403)
    assert_problem(await work.api("POST", field_url(table), "other_admin", json=body), 404)
    assert_problem(await work.api("POST", f"/tables/{MISSING}/fields", json=body), 404)


async def test_invalid_field_definitions_are_422(work: Work) -> None:
    table = await blank_table(work)
    bad: list[dict[str, Any]] = [
        {"name": "", "type": "text"},
        {"name": "x" * 201, "type": "text"},
        {"name": "A", "type": "unknown"},
        {"name": "A"},
        {"name": "A", "type": "number", "config": {"precision": 99}},
        {"name": "A", "type": "text", "config": {"surprise": True}},
        {
            "name": "A",
            "type": "single_select",
            "config": {"options": [{"name": "a"}, {"name": "A"}]},
        },
        {"name": "A", "type": "status", "config": {"options": [{"name": "a", "kind": "nope"}]}},
        {"name": "A", "type": "link_record", "config": {}},
        {"name": "A", "type": "text", "semantic": "assignee"},
        {"name": "A", "type": "text", "grants_view": True},
        {"name": "A", "type": "text", "id": MISSING},
        {"name": "A", "type": "text", "counter": 99},
        {"name": "A", "type": "text", "table_id": MISSING},
    ]
    for body in bad:
        assert_problem(await work.api("POST", field_url(table), json=body), 422)


async def test_field_names_are_unique_ignoring_case(work: Work) -> None:
    table = await blank_table(work)
    await work.make_field(table["id"], "Budget", "number")
    for name in ("budget", " BUDGET ", "name"):  # "Name" exists in every blank table
        assert_problem(
            await work.api("POST", field_url(table), json={"name": name, "type": "text"}), 409
        )


async def test_semantic_fields_can_only_exist_once(work: Work) -> None:
    table = await table_with_tasks(work)
    again = {"name": "Owner", "type": "user", "semantic": "assignee"}
    assert_problem(await work.api("POST", field_url(table), json=again), 409)
    due = {"name": "Deadline", "type": "date", "semantic": "due_date"}
    assert_problem(await work.api("POST", field_url(table), json=due), 409)


async def test_assignee_and_follower_grant_view_by_default(work: Work) -> None:
    table = await blank_table(work)
    assignee = await work.make_field(table["id"], "Who", "user", semantic="assignee")
    plain = await work.make_field(table["id"], "Reviewers", "user")
    opted_out = await work.make_field(
        table["id"], "Watching", "user", semantic="follower", grants_view=False
    )
    opted_in = await work.make_field(table["id"], "Experts", "user", grants_view=True)
    assert assignee["grants_view"] is True
    assert plain["grants_view"] is False
    assert opted_out["grants_view"] is False
    assert opted_in["grants_view"] is True


async def test_grants_view_cannot_be_changed_afterwards(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Experts", "user")
    response = await work.api("PATCH", f"/fields/{field['id']}", json={"grants_view": True})
    assert_problem(response, 422)  # ADR 0003: only chosen when the field is made


async def test_a_table_has_a_limited_number_of_fields(work: Work) -> None:
    table = await blank_table(work)
    for i in range(199):  # "Name" is the first of 200
        response = await work.api(
            "POST", field_url(table), json={"name": f"col{i}", "type": "text"}
        )
        assert response.status_code == 201
    assert_problem(
        await work.api("POST", field_url(table), json={"name": "last", "type": "text"}), 409
    )


async def test_required_field_cannot_be_added_to_a_table_with_records(
    work: Work, migrated_database_url: str
) -> None:
    table = await blank_table(work)
    first = await work.make_field(table["id"], "Code", "text", is_required=True)
    assert first["is_required"] is True
    created = await work.api(
        "POST", f"/tables/{table['id']}/records", json={"data": {first["id"]: "A1"}}
    )
    assert created.status_code == 201, created.text
    response = await work.api(
        "POST", field_url(table), json={"name": "Owner", "type": "text", "is_required": True}
    )
    assert_problem(response, 409)


# --- reading ---------------------------------------------------------------------------------


async def test_list_and_get_fields(work: Work) -> None:
    table = await table_with_tasks(work)
    listed = await work.api("GET", field_url(table), "viewer")
    assert listed.status_code == 200
    assert len(listed.json()) == 13
    assert {f["access"] for f in listed.json()} == {"read"}
    positions = [f["position"] for f in listed.json()]
    assert positions == sorted(positions)
    one = listed.json()[1]
    got = await work.api("GET", f"/fields/{one['id']}", "viewer")
    assert got.status_code == 200
    assert got.json()["id"] == one["id"]
    assert_problem(await work.api("GET", f"/fields/{one['id']}", "member"), 403)
    assert_problem(await work.api("GET", f"/fields/{one['id']}", "other_admin"), 404)
    assert_problem(await work.api("GET", f"/fields/{MISSING}"), 404)


# --- changing and deleting -------------------------------------------------------------------


async def test_rename_and_reorder_a_field(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Cost", "number")
    url = f"/fields/{field['id']}"
    renamed = await work.api("PATCH", url, "editor", json={"name": "Price", "position": 9})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Price"
    assert renamed.json()["position"] == 9
    assert renamed.json()["type"] == "number"
    assert_problem(await work.api("PATCH", url, "viewer", json={"name": "Z"}), 403)
    assert_problem(await work.api("PATCH", url, "member", json={"name": "Z"}), 403)
    assert_problem(await work.api("PATCH", url, json={"name": "name"}), 409)
    assert_problem(await work.api("PATCH", url, json={"name": ""}), 422)
    assert_problem(await work.api("PATCH", url, json={"position": -1}), 422)
    assert_problem(await work.api("PATCH", url, json={}), 422)
    assert_problem(await work.api("PATCH", url, json={"table_id": MISSING}), 422)
    assert_problem(await work.api("PATCH", url, "other_admin", json={"name": "Z"}), 404)


async def test_editing_options_keeps_ids_of_the_existing_ones(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(
        table["id"], "Stage", "single_select", config={"options": [{"name": "Open"}]}
    )
    open_id = field["config"]["options"][0]["id"]
    response = await work.api(
        "PATCH",
        f"/fields/{field['id']}",
        json={"config": {"options": [{"id": open_id, "name": "Opened"}, {"name": "Closed"}]}},
    )
    assert response.status_code == 200, response.text
    options = response.json()["config"]["options"]
    assert options[0] == {"id": open_id, "name": "Opened"}
    assert options[1]["name"] == "Closed"
    invented = await work.api(
        "PATCH",
        f"/fields/{field['id']}",
        json={"config": {"options": [{"id": "made-up", "name": "X"}]}},
    )
    assert_problem(invented, 422)


async def test_a_field_cannot_become_required_when_records_miss_a_value(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Note", "text")
    created = await work.api("POST", f"/tables/{table['id']}/records", json={"data": {}})
    assert created.status_code == 201
    assert_problem(
        await work.api("PATCH", f"/fields/{field['id']}", json={"is_required": True}), 409
    )


async def test_delete_a_field_is_a_soft_delete(work: Work, migrated_database_url: str) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Temp", "text")
    url = f"/fields/{field['id']}"
    assert_problem(await work.api("DELETE", url, "viewer"), 403)
    assert (await work.api("DELETE", url, "editor")).status_code == 204
    assert_problem(await work.api("GET", url), 404)
    names = [f["name"] for f in (await work.api("GET", field_url(table))).json()]
    assert "Temp" not in names
    rows = await db_fetch(
        migrated_database_url,
        "SELECT deleted_at FROM fields WHERE id = $1",
        uuid.UUID(field["id"]),
    )
    assert rows[0]["deleted_at"] is not None
    # The name is free again.
    assert await work.make_field(table["id"], "Temp", "number")


# --- links between tables --------------------------------------------------------------------


async def test_link_field_makes_a_mirror_field_on_the_other_table(work: Work) -> None:
    base_id = await work.make_base()
    projects = await work.make_table(base_id, "Projects")
    tasks = await work.make_table(base_id, "Tasks")
    link = await work.make_field(
        tasks["id"], "Project", "link_record", config={"table_id": projects["id"]}
    )
    assert link["config"]["table_id"] == projects["id"]
    inverse_id = link["config"]["inverse_field_id"]
    mirror = (await work.api("GET", f"/fields/{inverse_id}")).json()
    assert mirror["name"] == "Tasks"  # named after the table it comes from
    assert mirror["type"] == "link_record"
    assert mirror["table_id"] == projects["id"]
    assert mirror["config"]["table_id"] == tasks["id"]
    assert mirror["config"]["inverse_field_id"] == link["id"]


async def test_custom_name_for_the_mirror_field(work: Work) -> None:
    base_id = await work.make_base()
    projects = await work.make_table(base_id, "Projects")
    tasks = await work.make_table(base_id, "Tasks")
    link = await work.make_field(
        tasks["id"],
        "Project",
        "link_record",
        config={"table_id": projects["id"]},
        inverse_name="Work items",
    )
    mirror = (await work.api("GET", f"/fields/{link['config']['inverse_field_id']}")).json()
    assert mirror["name"] == "Work items"


async def test_link_needs_edit_rights_on_both_tables_and_the_same_base(work: Work) -> None:
    base_id = await work.make_base()
    other_base = await work.make_base("Other base")
    tasks = await work.make_table(base_id, "Tasks")
    elsewhere = await work.make_table(other_base, "Elsewhere")
    response = await work.api(
        "POST",
        field_url(tasks),
        json={"name": "Far", "type": "link_record", "config": {"table_id": elsewhere["id"]}},
    )
    assert_problem(response, 422)
    missing = await work.api(
        "POST",
        field_url(tasks),
        json={"name": "Far", "type": "link_record", "config": {"table_id": MISSING}},
    )
    assert_problem(missing, 404)
    # A table of another organization looks like it does not exist.
    foreign = await work.api(
        "POST",
        field_url(tasks),
        "admin",
        json={"name": "Far", "type": "link_record", "config": {"table_id": MISSING}},
    )
    assert_problem(foreign, 404)


async def test_parent_and_subtasks_must_link_a_table_to_itself(work: Work) -> None:
    base_id = await work.make_base()
    one = await work.make_table(base_id, "One")
    two = await work.make_table(base_id, "Two")
    response = await work.api(
        "POST",
        field_url(one),
        json={
            "name": "Up",
            "type": "link_record",
            "semantic": "parent",
            "config": {"table_id": two["id"]},
        },
    )
    assert_problem(response, 422)


async def test_parent_field_creates_subtasks_as_its_mirror(work: Work) -> None:
    table = await blank_table(work)
    parent = await work.make_field(
        table["id"],
        "Parent",
        "link_record",
        semantic="parent",
        config={"table_id": table["id"]},
        inverse_name="Children",
    )
    assert parent["config"]["multiple"] is False
    mirror = (await work.api("GET", f"/fields/{parent['config']['inverse_field_id']}")).json()
    assert mirror["semantic"] == "subtasks"
    assert mirror["config"]["multiple"] is True
    assert mirror["name"] == "Children"


async def test_deleting_a_link_field_deletes_its_mirror(work: Work) -> None:
    base_id = await work.make_base()
    projects = await work.make_table(base_id, "Projects")
    tasks = await work.make_table(base_id, "Tasks")
    link = await work.make_field(
        tasks["id"], "Project", "link_record", config={"table_id": projects["id"]}
    )
    mirror_id = link["config"]["inverse_field_id"]
    assert (await work.api("DELETE", f"/fields/{link['id']}")).status_code == 204
    assert_problem(await work.api("GET", f"/fields/{mirror_id}"), 404)


async def test_the_target_of_a_link_cannot_be_changed(work: Work) -> None:
    base_id = await work.make_base()
    projects = await work.make_table(base_id, "Projects")
    teams = await work.make_table(base_id, "Teams")
    tasks = await work.make_table(base_id, "Tasks")
    link = await work.make_field(
        tasks["id"], "Project", "link_record", config={"table_id": projects["id"]}
    )
    response = await work.api(
        "PATCH", f"/fields/{link['id']}", json={"config": {"table_id": teams["id"]}}
    )
    assert_problem(response, 422)


# --- access per column -----------------------------------------------------------------------


async def test_admin_hides_a_column_from_one_person(work: Work) -> None:
    table = await blank_table(work)
    secret = await work.make_field(table["id"], "Salary", "number")
    url = f"/fields/{secret['id']}/access/{work.users['viewer']}"
    put = await work.api("PUT", url, "wsadmin", json={"access": "hidden"})
    assert put.status_code == 200
    assert put.json()["access"] == "hidden"

    # The column is gone for that person everywhere in the API, not only in the interface.
    names = [f["name"] for f in (await work.api("GET", field_url(table), "viewer")).json()]
    assert "Salary" not in names
    detail = (await work.api("GET", f"/tables/{table['id']}", "viewer")).json()
    assert "Salary" not in [f["name"] for f in detail["fields"]]
    assert_problem(await work.api("GET", f"/fields/{secret['id']}", "viewer"), 404)
    # ... and still there for everybody else.
    names = [f["name"] for f in (await work.api("GET", field_url(table), "commenter")).json()]
    assert "Salary" in names
    names = [f["name"] for f in (await work.api("GET", field_url(table), "admin")).json()]
    assert "Salary" in names

    assert (await work.api("DELETE", url, "wsadmin")).status_code == 204
    names = [f["name"] for f in (await work.api("GET", field_url(table), "viewer")).json()]
    assert "Salary" in names


async def test_read_only_override_for_an_editor(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Budget", "number")
    url = f"/fields/{field['id']}/access/{work.users['editor']}"
    assert (await work.api("PUT", url, "admin", json={"access": "read"})).status_code == 200
    seen = {
        f["name"]: f["access"] for f in (await work.api("GET", field_url(table), "editor")).json()
    }
    assert seen["Budget"] == "read"
    assert seen["Name"] == "edit"


async def test_a_column_rule_never_gives_a_viewer_more_than_reading(work: Work) -> None:
    """Column rules only narrow: "edit" on one column does not let a workspace viewer write."""
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Notes", "text")
    url = f"/fields/{field['id']}/access/{work.users['viewer']}"
    await work.api("PUT", url, "admin", json={"access": "edit"})
    seen = {
        f["name"]: f["access"] for f in (await work.api("GET", field_url(table), "viewer")).json()
    }
    assert seen["Notes"] == "read"
    assert seen["Name"] == "read"


async def test_organization_admins_cannot_be_restricted(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Salary", "number")
    url = f"/fields/{field['id']}/access/{work.users['admin']}"
    await work.api("PUT", url, "admin", json={"access": "hidden"})
    names = [f["name"] for f in (await work.api("GET", field_url(table), "admin")).json()]
    assert "Salary" in names


async def test_only_workspace_admins_manage_column_access(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Salary", "number")
    url = f"/fields/{field['id']}/access/{work.users['viewer']}"
    for who in ("editor", "commenter", "viewer", "member"):
        assert_problem(await work.api("PUT", url, who, json={"access": "hidden"}), 403)
        assert_problem(await work.api("DELETE", url, who), 403)
        assert_problem(await work.api("GET", f"/fields/{field['id']}/access", who), 403)
    assert_problem(await work.api("PUT", url, "other_admin", json={"access": "hidden"}), 404)


async def test_column_access_input_is_validated(work: Work) -> None:
    table = await blank_table(work)
    field = await work.make_field(table["id"], "Salary", "number")
    base = f"/fields/{field['id']}/access"
    assert_problem(
        await work.api("PUT", f"{base}/{work.users['viewer']}", json={"access": "owner"}), 422
    )
    assert_problem(await work.api("PUT", f"{base}/{work.users['viewer']}", json={}), 422)
    assert_problem(await work.api("PUT", f"{base}/{MISSING}", json={"access": "hidden"}), 422)
    foreign = work.other["user_id"]
    assert_problem(await work.api("PUT", f"{base}/{foreign}", json={"access": "hidden"}), 422)
    assert_problem(await work.api("DELETE", f"{base}/{work.users['viewer']}"), 404)
    listed = await work.api("GET", base)
    assert listed.status_code == 200
    assert listed.json() == []
