import json
import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem, db_fetch
from tests.test_records import Board
from tests.work_world import Work

MISSING = str(uuid.uuid4())


class Links:
    """A Projects table and a Tasks table joined by a link field (Project <-> Tasks)."""

    def __init__(self, work: Work, projects: Board, tasks: Board, link: dict[str, Any]) -> None:
        self.work = work
        self.projects = projects
        self.tasks = tasks
        self.project_field = link["id"]  # on Tasks
        self.tasks_field = link["config"]["inverse_field_id"]  # on Projects

    async def project(self, name: str, who: str = "admin") -> dict[str, Any]:
        return await self.projects.create(who, Name=name)

    async def task(self, name: str, who: str = "admin", **cells: Any) -> dict[str, Any]:
        return await self.tasks.create(who, Name=name, **cells)

    async def get(self, record: dict[str, Any], who: str = "admin") -> dict[str, Any]:
        response = await self.work.api("GET", f"/records/{record['id']}", who)
        assert response.status_code == 200, response.text
        body: dict[str, Any] = response.json()
        return body

    async def set_project(self, task: dict[str, Any], value: Any, who: str = "admin") -> Any:
        current = await self.get(task)
        return await self.work.api(
            "PATCH",
            f"/records/{task['id']}",
            who,
            json={"data": {self.project_field: value}},
            headers={"If-Match": f'"{current["version"]}"'},
        )

    async def set_tasks(self, project: dict[str, Any], value: Any, who: str = "admin") -> Any:
        current = await self.get(project)
        return await self.work.api(
            "PATCH",
            f"/records/{project['id']}",
            who,
            json={"data": {self.tasks_field: value}},
            headers={"If-Match": f'"{current["version"]}"'},
        )

    async def tasks_of(self, project: dict[str, Any], who: str = "admin") -> list[str]:
        return list((await self.get(project, who))["data"][self.tasks_field])

    async def project_of(self, task: dict[str, Any], who: str = "admin") -> list[str]:
        return list((await self.get(task, who))["data"][self.project_field])


@pytest.fixture
async def links(work: Work) -> Links:
    base_id = await work.make_base()
    projects = Board(work, await work.make_table(base_id, "Projects"))
    tasks = Board(work, await work.make_table(base_id, "Tasks", template="tasks"))
    link = await work.make_field(
        tasks.id,
        "Project",
        "link_record",
        config={"table_id": projects.id, "multiple": False},
        inverse_name="Tasks list",
    )
    return Links(work, projects, tasks, link)


# --- two directions --------------------------------------------------------------------------


async def test_a_link_shows_on_both_records(links: Links, migrated_database_url: str) -> None:
    project = await links.project("Website")
    task = await links.task("Design")
    response = await links.set_project(task, [project["id"]])
    assert response.status_code == 200, response.text
    assert response.json()["data"][links.project_field] == [project["id"]]
    assert await links.tasks_of(project) == [task["id"]]
    rows = await db_fetch(
        migrated_database_url,
        "SELECT field_id, source_record_id, target_record_id FROM record_links",
    )
    assert {(str(r[0]), str(r[1]), str(r[2])) for r in rows} == {
        (links.project_field, task["id"], project["id"]),
        (links.tasks_field, project["id"], task["id"]),
    }


async def test_a_link_can_be_made_from_the_other_side(links: Links) -> None:
    project = await links.project("Website")
    one, two = await links.task("One"), await links.task("Two")
    response = await links.set_tasks(project, [one["id"], two["id"]])
    assert response.status_code == 200, response.text
    assert sorted(await links.tasks_of(project)) == sorted([one["id"], two["id"]])
    assert await links.project_of(one) == [project["id"]]
    assert await links.project_of(two) == [project["id"]]


async def test_links_can_be_given_when_a_record_is_created(links: Links) -> None:
    project = await links.project("Website")
    created = await links.work.api(
        "POST",
        f"/tables/{links.tasks.id}/records",
        json={"data": {links.tasks.f["Name"]: "Design", links.project_field: [project["id"]]}},
    )
    assert created.status_code == 201, created.text
    assert created.json()["data"][links.project_field] == [project["id"]]
    assert await links.tasks_of(project) == [created.json()["id"]]


async def test_changing_a_link_removes_the_old_one_on_both_sides(
    links: Links, migrated_database_url: str
) -> None:
    first, second = await links.project("A"), await links.project("B")
    task = await links.task("Moves")
    await links.set_project(task, [first["id"]])
    await links.set_project(task, [second["id"]])
    assert await links.tasks_of(first) == []
    assert await links.tasks_of(second) == [task["id"]]
    rows = await db_fetch(migrated_database_url, "SELECT count(*) AS n FROM record_links")
    assert rows[0]["n"] == 2


async def test_clearing_a_link(links: Links, migrated_database_url: str) -> None:
    project = await links.project("A")
    task = await links.task("T")
    await links.set_project(task, [project["id"]])
    cleared = await links.set_project(task, None)
    assert cleared.status_code == 200
    assert cleared.json()["data"][links.project_field] == []
    assert await links.tasks_of(project) == []
    rows = await db_fetch(migrated_database_url, "SELECT count(*) AS n FROM record_links")
    assert rows[0]["n"] == 0
    await links.set_project(task, [project["id"]])
    assert (await links.set_project(task, [])).status_code == 200
    assert await links.tasks_of(project) == []


async def test_a_single_valued_side_takes_over_a_task_from_its_old_project(links: Links) -> None:
    """A task has one project: giving it to another project takes it from the first."""
    first, second = await links.project("A"), await links.project("B")
    task = await links.task("T")
    await links.set_tasks(first, [task["id"]])
    await links.set_tasks(second, [task["id"]])
    assert await links.tasks_of(first) == []
    assert await links.tasks_of(second) == [task["id"]]
    assert await links.project_of(task) == [second["id"]]


async def test_a_single_link_field_takes_one_record(links: Links) -> None:
    first, second = await links.project("A"), await links.project("B")
    task = await links.task("T")
    assert_problem(await links.set_project(task, [first["id"], second["id"]]), 422)
    assert await links.project_of(task) == []


async def test_the_task_list_shows_links_for_each_row(links: Links) -> None:
    project = await links.project("A")
    one = await links.task("One")
    await links.task("Two")
    await links.set_project(one, [project["id"]])
    page = (await links.work.api("GET", f"/tables/{links.tasks.id}/records")).json()["items"]
    by_name = {i["data"][links.tasks.f["Name"]]: i["data"][links.project_field] for i in page}
    assert by_name == {"One": [project["id"]], "Two": []}


async def test_filter_by_link(links: Links) -> None:
    project = await links.project("A")
    one = await links.task("One")
    await links.task("Two")
    await links.set_project(one, [project["id"]])
    url = f"/tables/{links.tasks.id}/records"

    async def names(cond: dict[str, Any]) -> list[str]:
        response = await links.work.api("GET", url, params={"filter": json.dumps([cond])})
        assert response.status_code == 200, response.text
        return [i["data"][links.tasks.f["Name"]] for i in response.json()["items"]]

    field = links.project_field
    assert await names({"field": field, "op": "contains", "value": project["id"]}) == ["One"]
    assert await names({"field": field, "op": "is_empty"}) == ["Two"]
    assert await names({"field": field, "op": "is_not_empty"}) == ["One"]


# --- what a link may point at ----------------------------------------------------------------


async def test_links_must_point_at_records_of_the_linked_table(links: Links) -> None:
    other_task = await links.task("Not a project")
    task = await links.task("T")
    for bad in ([other_task["id"]], [MISSING], ["not-an-id"], "string"):
        assert_problem(await links.set_project(task, bad), 422)


async def test_a_record_cannot_link_to_itself(links: Links) -> None:
    # Tasks link to tasks through the parent field.
    task = await links.task("T")
    response = await links.work.api(
        "PATCH",
        f"/records/{task['id']}",
        json={"data": {links.tasks.f["Parent task"]: [task["id"]]}},
        headers={"If-Match": '"1"'},
    )
    assert_problem(response, 422)


async def test_a_deleted_record_cannot_be_linked_and_disappears_from_links(links: Links) -> None:
    project = await links.project("Old")
    task = await links.task("T")
    await links.set_project(task, [project["id"]])
    await links.work.api("DELETE", f"/records/{project['id']}")
    assert await links.project_of(task) == []
    other = await links.task("U")
    assert_problem(await links.set_project(other, [project["id"]]), 422)


async def test_a_link_never_reveals_records_you_cannot_see(links: Links) -> None:
    """member is assigned a task, but the project it belongs to is none of their business."""
    project = await links.project("Secret project")
    task = await links.task("Mine", Assignee=[links.tasks.user("member")])
    await links.set_project(task, [project["id"]])
    # The admin sees the link, the assignee sees the task without the link.
    assert await links.project_of(task, "admin") == [project["id"]]
    assert await links.project_of(task, "member") == []
    assert_problem(await links.work.api("GET", f"/records/{project['id']}", "member"), 403)
    page = (await links.work.api("GET", f"/tables/{links.tasks.id}/records", "member")).json()
    assert [i["data"][links.project_field] for i in page["items"]] == [[]]


async def test_you_cannot_link_to_a_record_you_cannot_see(links: Links) -> None:
    """After leaving the workspace an editor still owns their records but sees nothing else."""
    work = links.work
    secret = await links.project("Secret project")
    mine = await links.task("Mine", "editor")
    removed = await work.api(
        "DELETE", f"/workspaces/{work.workspace_id}/members/{links.tasks.user('editor')}"
    )
    assert removed.status_code == 204
    response = await links.set_project(mine, [secret["id"]], "editor")
    assert_problem(response, 422)  # said exactly like "does not exist"
    assert await links.project_of(mine) == []


async def test_hidden_link_columns_are_not_returned(links: Links) -> None:
    project = await links.project("A")
    task = await links.task("T")
    await links.set_project(task, [project["id"]])
    await links.work.api(
        "PUT",
        f"/fields/{links.project_field}/access/{links.tasks.user('viewer')}",
        json={"access": "hidden"},
    )
    assert links.project_field not in (await links.get(task, "viewer"))["data"]
    assert links.project_field in (await links.get(task, "editor"))["data"]


async def test_link_field_needs_read_only_for_editors_who_may_not_edit_it(links: Links) -> None:
    project = await links.project("A")
    task = await links.task("T")
    await links.work.api(
        "PUT",
        f"/fields/{links.project_field}/access/{links.tasks.user('editor')}",
        json={"access": "read"},
    )
    assert_problem(await links.set_project(task, [project["id"]], "editor"), 403)


async def test_deleting_the_link_field_hides_the_links(links: Links) -> None:
    project = await links.project("A")
    task = await links.task("T")
    await links.set_project(task, [project["id"]])
    await links.work.api("DELETE", f"/fields/{links.project_field}")
    assert links.project_field not in (await links.get(task))["data"]
    assert links.tasks_field not in (await links.get(project))["data"]


# --- parent and subtasks ---------------------------------------------------------------------


class Tree:
    def __init__(self, board: Board) -> None:
        self.board = board
        self.parent = board.f["Parent task"]
        self.subtasks = board.f["Subtasks"]

    async def make(self, name: str, parent: dict[str, Any] | None = None) -> dict[str, Any]:
        cells: dict[str, Any] = {"Name": name}
        if parent:
            cells["Parent task"] = [parent["id"]]
        return await self.board.create(**cells)

    async def get(self, record: dict[str, Any]) -> dict[str, Any]:
        response = await self.board.work.api("GET", f"/records/{record['id']}")
        body: dict[str, Any] = response.json()
        return body

    async def parent_of(self, record: dict[str, Any]) -> list[str]:
        return list((await self.get(record))["data"][self.parent])

    async def children_of(self, record: dict[str, Any]) -> list[str]:
        return list((await self.get(record))["data"][self.subtasks])

    async def set(self, record: dict[str, Any], field: str, value: Any) -> Any:
        current = await self.get(record)
        return await self.board.work.api(
            "PATCH",
            f"/records/{record['id']}",
            json={"data": {field: value}},
            headers={"If-Match": f'"{current["version"]}"'},
        )


@pytest.fixture
async def tree(work: Work) -> Tree:
    base_id = await work.make_base()
    return Tree(Board(work, await work.make_table(base_id, "Tasks", template="tasks")))


async def test_subtasks_are_tasks_that_name_a_parent(tree: Tree) -> None:
    parent = await tree.make("Launch")
    child = await tree.make("Write copy", parent)
    assert await tree.parent_of(child) == [parent["id"]]
    assert await tree.children_of(parent) == [child["id"]]
    second = await tree.make("Design", parent)
    assert sorted(await tree.children_of(parent)) == sorted([child["id"], second["id"]])


async def test_a_task_has_one_parent(tree: Tree) -> None:
    one, two = await tree.make("One"), await tree.make("Two")
    child = await tree.make("Child", one)
    assert (await tree.set(child, tree.parent, [two["id"]])).status_code == 200
    assert await tree.children_of(one) == []
    assert await tree.children_of(two) == [child["id"]]
    assert_problem(await tree.set(child, tree.parent, [one["id"], two["id"]]), 422)


async def test_setting_subtasks_from_the_parent_moves_them_from_their_old_parent(
    tree: Tree,
) -> None:
    old, new = await tree.make("Old parent"), await tree.make("New parent")
    child = await tree.make("Child", old)
    assert (await tree.set(new, tree.subtasks, [child["id"]])).status_code == 200
    assert await tree.parent_of(child) == [new["id"]]
    assert await tree.children_of(old) == []


async def test_a_task_cannot_become_its_own_ancestor(tree: Tree) -> None:
    top = await tree.make("Top")
    middle = await tree.make("Middle", top)
    bottom = await tree.make("Bottom", middle)
    # Top under Bottom would make a loop; so would Top under Middle, or Middle under Bottom.
    assert_problem(await tree.set(top, tree.parent, [bottom["id"]]), 422)
    assert_problem(await tree.set(top, tree.parent, [middle["id"]]), 422)
    assert_problem(await tree.set(middle, tree.parent, [bottom["id"]]), 422)
    # The same loops, written from the parent side.
    assert_problem(await tree.set(bottom, tree.subtasks, [top["id"]]), 422)
    assert_problem(await tree.set(bottom, tree.subtasks, [middle["id"]]), 422)
    assert await tree.parent_of(top) == []
    # Moving to a different branch is fine.
    other = await tree.make("Other branch")
    assert (await tree.set(bottom, tree.parent, [other["id"]])).status_code == 200


async def test_every_link_row_has_its_mirror(tree: Tree, migrated_database_url: str) -> None:
    a, b, c = await tree.make("A"), await tree.make("B"), await tree.make("C")
    await tree.set(b, tree.parent, [a["id"]])
    await tree.set(c, tree.parent, [a["id"]])
    await tree.set(c, tree.parent, [b["id"]])
    await tree.set(a, tree.subtasks, [])
    await tree.set(b, tree.parent, None)
    rows = await db_fetch(
        migrated_database_url,
        "SELECT l.field_id FROM record_links l LEFT JOIN fields f ON f.id = l.field_id "
        "WHERE NOT EXISTS (SELECT 1 FROM record_links m "
        "                  WHERE m.field_id = (f.config ->> 'inverse_field_id')::uuid "
        "                    AND m.source_record_id = l.target_record_id "
        "                    AND m.target_record_id = l.source_record_id)",
    )
    assert rows == []


async def test_the_parent_link_is_not_a_way_to_see_other_peoples_tasks(
    tree: Tree, work: Work
) -> None:
    board = tree.board
    parent = await board.create(Name="Secret parent")
    child = await board.create(Name="Mine", Assignee=[board.user("member")])
    await tree.set(child, tree.parent, [parent["id"]])
    seen = (await work.api("GET", f"/records/{child['id']}", "member")).json()
    assert seen["data"][tree.parent] == []
    assert_problem(await work.api("GET", f"/records/{parent['id']}", "member"), 403)
