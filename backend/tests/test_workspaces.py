import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.permissions.service import role_at_least
from app.modules.users.models import OrgRole, UserLevel, UserStatus
from app.modules.workspaces.models import WorkspaceRole
from tests.api_helpers import assert_problem, db_fetch, login_as
from tests.factories import create_other_organization, create_user


class World:
    """An organization with an admin, one shared workspace and one user per workspace role."""

    def __init__(self) -> None:
        self.users: dict[str, uuid.UUID] = {}
        self.headers: dict[str, dict[str, str]] = {}
        self.workspace_id = ""


@pytest.fixture
async def world(client: AsyncClient, migrated_database_url: str) -> World:
    w = World()
    names = ["viewer", "commenter", "editor", "wsadmin", "outsider"]
    w.users["admin"] = await create_user(
        migrated_database_url, employee_code="ADMIN", level=UserLevel.ADMIN, org_role=OrgRole.ADMIN
    )
    for name in names:
        w.users[name] = await create_user(migrated_database_url, employee_code=name.upper())
    w.headers["admin"] = await login_as(client, "ADMIN")

    created = await client.post(
        "/api/v1/workspaces", json={"name": "Projects"}, headers=w.headers["admin"]
    )
    assert created.status_code == 201
    w.workspace_id = created.json()["id"]

    roles = {
        "viewer": "viewer",
        "commenter": "commenter",
        "editor": "editor",
        "wsadmin": "admin",
    }
    for name, role in roles.items():
        added = await client.post(
            f"/api/v1/workspaces/{w.workspace_id}/members",
            json={"user_id": str(w.users[name]), "role": role},
            headers=w.headers["admin"],
        )
        assert added.status_code == 201, added.text
    for name in names:
        w.headers[name] = await login_as(client, name.upper())
    return w


def path(world: World, suffix: str = "") -> str:
    return f"/api/v1/workspaces/{world.workspace_id}{suffix}"


# --- the role ladder -------------------------------------------------------------------------


def test_role_ladder() -> None:
    order = [
        WorkspaceRole.VIEWER,
        WorkspaceRole.COMMENTER,
        WorkspaceRole.EDITOR,
        WorkspaceRole.ADMIN,
    ]
    for i, low in enumerate(order):
        for j, high in enumerate(order):
            assert role_at_least(high, low) is (j >= i)


# --- listing ---------------------------------------------------------------------------------


async def test_default_list_shows_only_my_workspaces(client: AsyncClient, world: World) -> None:
    response = await client.get("/api/v1/workspaces", headers=world.headers["viewer"])
    assert response.status_code == 200
    items = response.json()
    assert {(i["kind"], i["my_role"]) for i in items} == {
        ("personal", "admin"),
        ("shared", "viewer"),
    }
    # Another employee's personal workspace is not listed.
    own = next(i for i in items if i["kind"] == "personal")
    assert own["owner_user_id"] == str(world.users["viewer"])


async def test_someone_with_no_membership_sees_only_their_personal_workspace(
    client: AsyncClient, world: World
) -> None:
    items = (await client.get("/api/v1/workspaces", headers=world.headers["outsider"])).json()
    assert [i["kind"] for i in items] == ["personal"]


async def test_scope_all_is_for_admins(client: AsyncClient, world: World) -> None:
    everything = await client.get("/api/v1/workspaces?scope=all", headers=world.headers["admin"])
    assert everything.status_code == 200
    assert len(everything.json()) == 7  # six personal workspaces and the shared one

    assert_problem(
        await client.get("/api/v1/workspaces?scope=all", headers=world.headers["wsadmin"]), 403
    )
    assert_problem(
        await client.get("/api/v1/workspaces?scope=bogus", headers=world.headers["admin"]), 422
    )


async def test_anonymous_gets_401_everywhere(client: AsyncClient, world: World) -> None:
    # The client keeps the cookie of the last login (done while building the world).
    client.cookies.clear()
    for method, url, body in [
        ("GET", "/api/v1/workspaces", None),
        ("POST", "/api/v1/workspaces", {"name": "x"}),
        ("GET", path(world), None),
        ("PATCH", path(world), {"name": "x"}),
        ("DELETE", path(world), None),
        ("GET", path(world, "/members"), None),
        ("POST", path(world, "/members"), {"user_id": str(uuid.uuid4()), "role": "viewer"}),
    ]:
        assert_problem(await client.request(method, url, json=body), 401)


# --- creating ---------------------------------------------------------------------------------


async def test_only_admins_create_shared_workspaces(client: AsyncClient, world: World) -> None:
    for who in ("viewer", "editor", "wsadmin"):
        response = await client.post(
            "/api/v1/workspaces", json={"name": "Mine"}, headers=world.headers[who]
        )
        assert_problem(response, 403)

    ok = await client.post(
        "/api/v1/workspaces", json={"name": "  Finance  "}, headers=world.headers["admin"]
    )
    assert ok.status_code == 201
    assert ok.headers["location"] == f"/api/v1/workspaces/{ok.json()['id']}"
    assert ok.json()["name"] == "Finance"
    assert (ok.json()["kind"], ok.json()["owner_user_id"], ok.json()["my_role"]) == (
        "shared",
        None,
        "admin",
    )


@pytest.mark.parametrize(
    "payload",
    [{}, {"name": ""}, {"name": "   "}, {"name": "x" * 201}, {"name": "A", "kind": "personal"}],
)
async def test_invalid_workspace_input_is_422(
    client: AsyncClient, world: World, payload: dict[str, Any]
) -> None:
    assert_problem(
        await client.post("/api/v1/workspaces", json=payload, headers=world.headers["admin"]), 422
    )


# --- reading: who gets in --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("who", "role"),
    [("viewer", "viewer"), ("commenter", "commenter"), ("editor", "editor"), ("wsadmin", "admin")],
)
async def test_members_read_the_workspace_with_their_role(
    client: AsyncClient, world: World, who: str, role: str
) -> None:
    response = await client.get(path(world), headers=world.headers[who])
    assert response.status_code == 200
    assert response.json()["my_role"] == role


async def test_a_non_member_is_refused_with_403(client: AsyncClient, world: World) -> None:
    headers = world.headers["outsider"]
    assert_problem(await client.get(path(world), headers=headers), 403)
    assert_problem(await client.get(path(world, "/members"), headers=headers), 403)


async def test_org_admins_can_open_any_workspace_including_personal_ones(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    rows = await db_fetch(
        migrated_database_url,
        "SELECT id FROM workspaces WHERE owner_user_id = $1",
        world.users["outsider"],
    )
    personal = rows[0]["id"]
    response = await client.get(f"/api/v1/workspaces/{personal}", headers=world.headers["admin"])
    assert response.status_code == 200
    assert response.json()["my_role"] == "admin"


async def test_guessing_the_id_of_someone_elses_personal_workspace_gives_403(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    rows = await db_fetch(
        migrated_database_url,
        "SELECT id FROM workspaces WHERE owner_user_id = $1",
        world.users["viewer"],
    )
    victim = f"/api/v1/workspaces/{rows[0]['id']}"
    attacker = world.headers["editor"]

    for method, body in [
        ("GET", None),
        ("PATCH", {"name": "Pwned"}),
        ("DELETE", None),
    ]:
        assert_problem(await client.request(method, victim, json=body, headers=attacker), 403)
    assert_problem(await client.get(f"{victim}/members", headers=attacker), 403)
    assert_problem(
        await client.post(
            f"{victim}/members",
            json={"user_id": str(world.users["editor"]), "role": "admin"},
            headers=attacker,
        ),
        403,
    )

    after = await db_fetch(
        migrated_database_url, "SELECT name FROM workspaces WHERE id = $1", rows[0]["id"]
    )
    assert after[0]["name"] == "Personal"
    members = await db_fetch(
        migrated_database_url,
        "SELECT 1 FROM workspace_members WHERE workspace_id = $1",
        rows[0]["id"],
    )
    assert len(members) == 1


async def test_unknown_and_malformed_ids(client: AsyncClient, world: World) -> None:
    headers = world.headers["admin"]
    assert_problem(await client.get(f"/api/v1/workspaces/{uuid.uuid4()}", headers=headers), 404)
    assert_problem(await client.get("/api/v1/workspaces/not-a-uuid", headers=headers), 422)


async def test_a_workspace_of_another_organization_does_not_exist_for_me(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    await create_other_organization(migrated_database_url)
    rows = await db_fetch(
        migrated_database_url,
        "SELECT w.id FROM workspaces w JOIN organizations o ON o.id = w.organization_id"
        " WHERE o.name = 'Other company'",
    )
    # The other organization has no workspace yet: create one directly and try to reach it.
    org_id = (
        await db_fetch(
            migrated_database_url, "SELECT id FROM organizations WHERE name = 'Other company'"
        )
    )[0]["id"]
    assert rows == []
    import asyncpg

    from tests.helpers import asyncpg_dsn

    conn = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        foreign_id = await conn.fetchval(
            "INSERT INTO workspaces (organization_id, name, kind) VALUES ($1, 'Secret', 'shared')"
            " RETURNING id",
            org_id,
        )
    finally:
        await conn.close()

    # Not even an admin of our organization can see it, and it is reported as not existing.
    for who in ("admin", "wsadmin"):
        response = await client.get(f"/api/v1/workspaces/{foreign_id}", headers=world.headers[who])
        assert_problem(response, 404)
    assert_problem(
        await client.delete(f"/api/v1/workspaces/{foreign_id}", headers=world.headers["admin"]), 404
    )


# --- renaming and deleting -------------------------------------------------------------------


@pytest.mark.parametrize("who", ["viewer", "commenter", "editor", "outsider"])
async def test_only_workspace_admins_rename(client: AsyncClient, world: World, who: str) -> None:
    response = await client.patch(
        path(world), json={"name": "Hijacked"}, headers=world.headers[who]
    )
    assert_problem(response, 403)
    assert (await client.get(path(world), headers=world.headers["admin"])).json()[
        "name"
    ] == "Projects"


@pytest.mark.parametrize("who", ["wsadmin", "admin"])
async def test_workspace_admins_and_org_admins_rename(
    client: AsyncClient, world: World, who: str
) -> None:
    response = await client.patch(path(world), json={"name": "Renamed"}, headers=world.headers[who])
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"


async def test_deleting_is_soft_and_admin_only(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    assert_problem(await client.delete(path(world), headers=world.headers["editor"]), 403)

    deleted = await client.delete(path(world), headers=world.headers["wsadmin"])
    assert deleted.status_code == 204

    assert_problem(await client.get(path(world), headers=world.headers["admin"]), 404)
    listed = await client.get("/api/v1/workspaces", headers=world.headers["wsadmin"])
    assert all(i["id"] != world.workspace_id for i in listed.json())
    # The row is still in the database (soft delete).
    rows = await db_fetch(
        migrated_database_url,
        "SELECT deleted_at FROM workspaces WHERE id = $1",
        uuid.UUID(world.workspace_id),
    )
    assert rows[0]["deleted_at"] is not None


async def test_a_personal_workspace_cannot_be_deleted(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    rows = await db_fetch(
        migrated_database_url,
        "SELECT id FROM workspaces WHERE owner_user_id = $1",
        world.users["viewer"],
    )
    own = f"/api/v1/workspaces/{rows[0]['id']}"
    assert_problem(await client.delete(own, headers=world.headers["viewer"]), 409)
    # The owner is the admin of their personal workspace, so renaming is allowed.
    renamed = await client.patch(own, json={"name": "My desk"}, headers=world.headers["viewer"])
    assert renamed.status_code == 200


# --- members ---------------------------------------------------------------------------------


async def test_every_member_can_list_members(client: AsyncClient, world: World) -> None:
    response = await client.get(path(world, "/members"), headers=world.headers["viewer"])
    assert response.status_code == 200
    roles = {m["employee_code"]: m["role"] for m in response.json()}
    assert roles == {
        "ADMIN": "admin",
        "VIEWER": "viewer",
        "COMMENTER": "commenter",
        "EDITOR": "editor",
        "WSADMIN": "admin",
    }
    assert "password" not in response.text.lower()


@pytest.mark.parametrize("who", ["viewer", "commenter", "editor", "outsider"])
async def test_only_workspace_admins_change_membership(
    client: AsyncClient, world: World, who: str
) -> None:
    headers = world.headers[who]
    target = str(world.users["outsider"])

    add = await client.post(
        path(world, "/members"), json={"user_id": target, "role": "viewer"}, headers=headers
    )
    promote_self = await client.patch(
        path(world, f"/members/{world.users[who]}"), json={"role": "admin"}, headers=headers
    )
    remove_other = await client.delete(
        path(world, f"/members/{world.users['viewer']}"), headers=headers
    )

    for response in (add, promote_self, remove_other):
        assert_problem(response, 403)
    # Nothing changed: the viewer is still a member and nobody was promoted.
    members = (await client.get(path(world, "/members"), headers=world.headers["admin"])).json()
    assert {m["employee_code"]: m["role"] for m in members}.get("VIEWER") == "viewer"
    assert "OUTSIDER" not in {m["employee_code"] for m in members}
    if who != "outsider":
        assert {m["employee_code"]: m["role"] for m in members}[who.upper()] != "admin"


async def test_workspace_admin_manages_members(client: AsyncClient, world: World) -> None:
    headers = world.headers["wsadmin"]
    outsider = world.users["outsider"]

    added = await client.post(
        path(world, "/members"), json={"user_id": str(outsider), "role": "viewer"}, headers=headers
    )
    assert added.status_code == 201
    assert added.json()["role"] == "viewer"
    assert added.headers["location"] == path(world, f"/members/{outsider}")

    # The new member can now read the workspace.
    assert (await client.get(path(world), headers=world.headers["outsider"])).status_code == 200

    changed = await client.patch(
        path(world, f"/members/{outsider}"), json={"role": "editor"}, headers=headers
    )
    assert changed.json()["role"] == "editor"

    removed = await client.delete(path(world, f"/members/{outsider}"), headers=headers)
    assert removed.status_code == 204
    # And they lose access right away.
    assert_problem(await client.get(path(world), headers=world.headers["outsider"]), 403)


async def test_membership_input_rules(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    headers = world.headers["admin"]
    members = path(world, "/members")

    # Already a member.
    dup = await client.post(
        members, json={"user_id": str(world.users["viewer"]), "role": "editor"}, headers=headers
    )
    assert_problem(dup, 409)
    # Unknown employee, bad role, extra field.
    assert_problem(
        await client.post(
            members, json={"user_id": str(uuid.uuid4()), "role": "viewer"}, headers=headers
        ),
        422,
    )
    assert_problem(
        await client.post(
            members, json={"user_id": str(world.users["outsider"]), "role": "god"}, headers=headers
        ),
        422,
    )
    assert_problem(
        await client.post(
            members,
            json={"user_id": str(world.users["outsider"]), "role": "viewer", "extra": 1},
            headers=headers,
        ),
        422,
    )
    # Not a member: patching or removing says so.
    assert_problem(
        await client.patch(
            path(world, f"/members/{world.users['outsider']}"),
            json={"role": "viewer"},
            headers=headers,
        ),
        404,
    )
    assert_problem(
        await client.delete(path(world, f"/members/{world.users['outsider']}"), headers=headers),
        404,
    )


async def test_disabled_and_foreign_employees_cannot_be_added(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    off = await create_user(migrated_database_url, employee_code="GONE", status=UserStatus.DISABLED)
    other = await create_other_organization(migrated_database_url)
    headers = world.headers["admin"]

    for user_id in (off, other["user_id"]):
        response = await client.post(
            path(world, "/members"),
            json={"user_id": str(user_id), "role": "viewer"},
            headers=headers,
        )
        assert_problem(response, 422)


async def test_personal_workspace_membership_is_fixed(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    rows = await db_fetch(
        migrated_database_url,
        "SELECT id FROM workspaces WHERE owner_user_id = $1",
        world.users["viewer"],
    )
    own = f"/api/v1/workspaces/{rows[0]['id']}/members"
    headers = world.headers["viewer"]

    add = await client.post(
        own, json={"user_id": str(world.users["editor"]), "role": "viewer"}, headers=headers
    )
    remove_owner = await client.delete(f"{own}/{world.users['viewer']}", headers=headers)
    assert_problem(add, 409)
    assert_problem(remove_owner, 409)


async def test_org_admins_manage_members_without_being_listed_as_members(
    client: AsyncClient, world: World, migrated_database_url: str
) -> None:
    # A second admin is not in workspace_members but still has full control.
    await create_user(
        migrated_database_url, employee_code="ADMIN2", level=UserLevel.ADMIN, org_role=OrgRole.ADMIN
    )
    headers = await login_as(client, "ADMIN2")
    response = await client.patch(
        path(world, f"/members/{world.users['viewer']}"), json={"role": "editor"}, headers=headers
    )
    assert response.status_code == 200
    # An implicit admin has no membership row, so there is nothing to patch for them.
    admin2 = (
        await db_fetch(migrated_database_url, "SELECT id FROM users WHERE employee_code = 'ADMIN2'")
    )[0]["id"]
    assert_problem(
        await client.patch(
            path(world, f"/members/{admin2}"), json={"role": "viewer"}, headers=headers
        ),
        404,
    )


async def test_disabled_users_lose_workspace_access(client: AsyncClient, world: World) -> None:
    admin = world.headers["admin"]
    assert (await client.get(path(world), headers=world.headers["editor"])).status_code == 200
    await client.patch(
        f"/api/v1/users/{world.users['editor']}", json={"status": "disabled"}, headers=admin
    )
    assert_problem(await client.get(path(world), headers=world.headers["editor"]), 401)
