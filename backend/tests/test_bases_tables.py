import uuid

from httpx import AsyncClient

from tests.api_helpers import assert_problem, db_fetch
from tests.work_world import Work

MISSING = str(uuid.uuid4())


# --- bases -----------------------------------------------------------------------------------


async def test_editor_creates_a_base(work: Work) -> None:
    response = await work.api(
        "POST", f"/workspaces/{work.workspace_id}/bases", "editor", json={"name": "Sales"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Sales"
    assert body["workspace_id"] == work.workspace_id
    assert response.headers["location"] == f"/api/v1/bases/{body['id']}"


async def test_org_admin_creates_a_base_in_any_workspace(work: Work) -> None:
    assert await work.make_base("Admin base")


async def test_only_workspace_editors_create_bases(work: Work) -> None:
    for who in ("viewer", "commenter", "member"):
        response = await work.api(
            "POST", f"/workspaces/{work.workspace_id}/bases", who, json={"name": "Nope"}
        )
        assert_problem(response, 403)


async def test_creating_a_base_needs_login(client: AsyncClient, work: Work) -> None:
    response = await client.post(
        f"/api/v1/workspaces/{work.workspace_id}/bases", json={"name": "Nope"}
    )
    assert_problem(response, 401)


async def test_base_in_a_missing_workspace_is_404(work: Work) -> None:
    response = await work.api("POST", f"/workspaces/{MISSING}/bases", json={"name": "x"})
    assert_problem(response, 404)


async def test_another_organization_cannot_reach_the_workspace(work: Work) -> None:
    base_id = await work.make_base()
    created = await work.api(
        "POST", f"/workspaces/{work.workspace_id}/bases", "other_admin", json={"name": "Hack"}
    )
    assert_problem(created, 404)
    for method, url in (
        ("GET", f"/workspaces/{work.workspace_id}/bases"),
        ("GET", f"/bases/{base_id}"),
        ("GET", f"/bases/{base_id}/tables"),
    ):
        assert_problem(await work.api(method, url, "other_admin"), 404)
    assert_problem(await work.api("DELETE", f"/bases/{base_id}", "other_admin"), 404)


async def test_base_name_must_be_valid_and_unique(work: Work) -> None:
    url = f"/workspaces/{work.workspace_id}/bases"
    await work.make_base("Sales")
    assert_problem(await work.api("POST", url, json={"name": "sales"}), 409)
    assert_problem(await work.api("POST", url, json={"name": "  SALES  "}), 409)
    assert_problem(await work.api("POST", url, json={"name": ""}), 422)
    assert_problem(await work.api("POST", url, json={"name": "   "}), 422)
    assert_problem(await work.api("POST", url, json={"name": "x" * 201}), 422)
    assert_problem(await work.api("POST", url, json={}), 422)
    assert_problem(await work.api("POST", url, json={"name": "Ok", "workspace_id": MISSING}), 422)


async def test_viewers_list_and_read_bases_but_outsiders_cannot(work: Work) -> None:
    base_id = await work.make_base()
    listed = await work.api("GET", f"/workspaces/{work.workspace_id}/bases", "viewer")
    assert listed.status_code == 200
    assert [b["id"] for b in listed.json()] == [base_id]
    assert (await work.api("GET", f"/bases/{base_id}", "viewer")).status_code == 200
    assert_problem(await work.api("GET", f"/workspaces/{work.workspace_id}/bases", "member"), 403)
    assert_problem(await work.api("GET", f"/bases/{base_id}", "member"), 403)


async def test_rename_a_base(work: Work) -> None:
    base_id = await work.make_base("Old")
    ok = await work.api("PATCH", f"/bases/{base_id}", "editor", json={"name": "New"})
    assert ok.status_code == 200
    assert ok.json()["name"] == "New"
    assert_problem(await work.api("PATCH", f"/bases/{base_id}", "viewer", json={"name": "X"}), 403)
    other = await work.make_base("Other")
    assert_problem(await work.api("PATCH", f"/bases/{other}", json={"name": "new"}), 409)
    # Keeping its own name (even in other capitals) is not a clash.
    assert (await work.api("PATCH", f"/bases/{other}", json={"name": "OTHER"})).status_code == 200
    assert_problem(await work.api("PATCH", f"/bases/{other}", json={"id": MISSING}), 422)


async def test_only_workspace_admins_delete_a_base(work: Work) -> None:
    base_id = await work.make_base()
    assert_problem(await work.api("DELETE", f"/bases/{base_id}", "editor"), 403)
    assert (await work.api("DELETE", f"/bases/{base_id}", "wsadmin")).status_code == 204
    assert_problem(await work.api("GET", f"/bases/{base_id}"), 404)
    # The name can be used again after the base is deleted.
    assert await work.make_base("Projects")


async def test_deleting_a_base_hides_its_tables(work: Work) -> None:
    base_id = await work.make_base()
    table = await work.make_table(base_id)
    await work.api("DELETE", f"/bases/{base_id}")
    assert_problem(await work.api("GET", f"/tables/{table['id']}"), 404)
    assert_problem(await work.api("GET", f"/tables/{table['id']}/fields"), 404)


async def test_deleting_a_workspace_hides_its_bases(work: Work) -> None:
    base_id = await work.make_base()
    await work.api("DELETE", f"/workspaces/{work.workspace_id}")
    assert_problem(await work.api("GET", f"/bases/{base_id}"), 404)


# --- tables ----------------------------------------------------------------------------------


async def test_blank_table_has_a_name_field(work: Work) -> None:
    table = await work.make_table(await work.make_base())
    assert [f["name"] for f in table["fields"]] == ["Name"]
    assert table["fields"][0]["type"] == "text"
    assert table["my_role"] == "admin"


async def test_tasks_template_has_the_fields_a_task_needs(work: Work) -> None:
    table = await work.make_table(await work.make_base(), template="tasks")
    by_name = {f["name"]: f for f in table["fields"]}
    assert list(by_name) == [
        "Name",
        "Assignee",
        "Follower",
        "Status",
        "Due date",
        "Priority",
        "Timer",
        "Progress update",
        "Result",
        "Files",
        "Manager feedback",
        "Parent task",
        "Subtasks",
    ]
    assert by_name["Manager feedback"]["semantic"] == "feedback"
    assert [o["name"] for o in by_name["Priority"]["config"]["options"]] == [
        "High",
        "Medium",
        "Low",
    ]
    assert by_name["Timer"]["type"] == "timer"
    assert by_name["Timer"]["semantic"] is None
    assert by_name["Assignee"]["semantic"] == "assignee"
    assert by_name["Assignee"]["grants_view"] is True
    assert by_name["Follower"]["grants_view"] is True
    assert by_name["Status"]["semantic"] == "status"
    kinds = [o["kind"] for o in by_name["Status"]["config"]["options"]]
    assert kinds == ["todo", "in_progress", "review", "done", "paused", "blocked"]
    assert by_name["Due date"]["semantic"] == "due_date"
    assert by_name["Parent task"]["semantic"] == "parent"
    assert by_name["Parent task"]["config"]["multiple"] is False
    assert by_name["Subtasks"]["semantic"] == "subtasks"
    assert by_name["Subtasks"]["config"]["inverse_field_id"] == by_name["Parent task"]["id"]


async def test_unknown_template_is_rejected(work: Work) -> None:
    base_id = await work.make_base()
    response = await work.api(
        "POST", f"/bases/{base_id}/tables", json={"name": "T", "template": "hacker"}
    )
    assert_problem(response, 422)


async def test_table_permissions(work: Work) -> None:
    base_id = await work.make_base()
    for who in ("viewer", "commenter", "member"):
        response = await work.api("POST", f"/bases/{base_id}/tables", who, json={"name": "T"})
        assert_problem(response, 403)
    ok = await work.api("POST", f"/bases/{base_id}/tables", "editor", json={"name": "T"})
    assert ok.status_code == 201
    assert ok.headers["location"] == f"/api/v1/tables/{ok.json()['id']}"
    assert_problem(
        await work.api("POST", f"/bases/{base_id}/tables", "other_admin", json={"name": "T"}), 404
    )
    assert_problem(await work.api("POST", f"/bases/{MISSING}/tables", json={"name": "T"}), 404)


async def test_table_names_are_unique_within_a_base_only(work: Work) -> None:
    first = await work.make_base("A")
    second = await work.make_base("B")
    await work.make_table(first, "Tasks")
    assert_problem(await work.api("POST", f"/bases/{first}/tables", json={"name": "tasks"}), 409)
    assert await work.make_table(second, "Tasks")


async def test_read_a_table_and_list_tables(work: Work) -> None:
    base_id = await work.make_base()
    table = await work.make_table(base_id, "Tasks")
    listed = await work.api("GET", f"/bases/{base_id}/tables", "viewer")
    assert [t["id"] for t in listed.json()] == [table["id"]]
    detail = await work.api("GET", f"/tables/{table['id']}", "viewer")
    assert detail.status_code == 200
    assert detail.json()["my_role"] == "viewer"
    assert [f["access"] for f in detail.json()["fields"]] == ["read"]
    editor = await work.api("GET", f"/tables/{table['id']}", "editor")
    assert [f["access"] for f in editor.json()["fields"]] == ["edit"]


async def test_outsiders_cannot_read_a_table(work: Work) -> None:
    table = await work.make_table(await work.make_base())
    # `member` is in the organization but not in the workspace and has no record to see.
    assert_problem(await work.api("GET", f"/tables/{table['id']}", "member"), 403)
    assert_problem(await work.api("GET", f"/tables/{table['id']}/fields", "member"), 403)
    assert_problem(await work.api("GET", f"/tables/{table['id']}", "other_admin"), 404)
    assert_problem(await work.api("GET", f"/tables/{MISSING}"), 404)


async def test_rename_and_delete_a_table(work: Work, migrated_database_url: str) -> None:
    base_id = await work.make_base()
    table = await work.make_table(base_id, "Old")
    other = await work.make_table(base_id, "Other")
    url = f"/tables/{table['id']}"
    assert (await work.api("PATCH", url, "editor", json={"name": "New"})).json()["name"] == "New"
    assert_problem(await work.api("PATCH", url, "viewer", json={"name": "X"}), 403)
    assert_problem(await work.api("PATCH", url, json={"name": "other"}), 409)
    assert_problem(
        await work.api("PATCH", f"/tables/{other['id']}", "member", json={"name": "z"}), 403
    )
    assert_problem(await work.api("DELETE", url, "editor"), 403)
    assert (await work.api("DELETE", url, "wsadmin")).status_code == 204
    assert_problem(await work.api("GET", url), 404)
    # Soft delete: the row is still there.
    rows = await db_fetch(
        migrated_database_url,
        "SELECT deleted_at FROM tables WHERE id = $1",
        uuid.UUID(table["id"]),
    )
    assert rows[0]["deleted_at"] is not None
    assert await work.make_table(base_id, "New")
