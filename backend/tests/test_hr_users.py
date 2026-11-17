import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.users.models import OrgRole, UserLevel, UserStatus
from tests.api_helpers import (
    assert_problem,
    db_fetch,
    login,
    login_as,
    session_cookie,
    with_cookie,
)
from tests.factories import PASSWORD, create_other_organization, create_user

NEW_USER = {
    "employee_code": "NV100",
    "full_name": "Nguyen Van B",
    "password": "Initial-Pass-1",
}


async def make_admin(url: str, code: str = "ADMIN") -> uuid.UUID:
    return await create_user(url, employee_code=code, level=UserLevel.ADMIN, org_role=OrgRole.ADMIN)


async def make_owner(url: str, code: str = "OWNER") -> uuid.UUID:
    return await create_user(url, employee_code=code, level=UserLevel.ADMIN, org_role=OrgRole.OWNER)


# --- who may use the HR module ---------------------------------------------------------------


def _hr_requests(target: uuid.UUID) -> list[tuple[str, str, dict[str, Any] | None]]:
    return [
        ("GET", "/api/v1/users", None),
        ("POST", "/api/v1/users", NEW_USER),
        ("GET", f"/api/v1/users/{target}", None),
        ("PATCH", f"/api/v1/users/{target}", {"full_name": "Hacked"}),
        ("GET", "/api/v1/departments", None),
        ("POST", "/api/v1/departments", {"name": "X", "kind": "division"}),
        ("DELETE", f"/api/v1/departments/{target}", None),
    ]


async def test_anonymous_users_get_401_on_every_hr_endpoint(
    client: AsyncClient, migrated_database_url: str
) -> None:
    target = await make_admin(migrated_database_url)
    for method, path, body in _hr_requests(target):
        response = await client.request(method, path, json=body)
        assert_problem(response, 401)


async def test_a_plain_employee_gets_403_on_every_hr_endpoint(
    client: AsyncClient, migrated_database_url: str
) -> None:
    target = await make_admin(migrated_database_url)
    await create_user(migrated_database_url, employee_code="EMP")
    headers = await login_as(client, "EMP")

    for method, path, body in _hr_requests(target):
        response = await client.request(method, path, json=body, headers=headers)
        assert_problem(response, 403)

    # And nothing was changed by those attempts.
    rows = await db_fetch(
        migrated_database_url, "SELECT full_name FROM users WHERE id = $1", target
    )
    assert rows[0]["full_name"] != "Hacked"


@pytest.mark.parametrize("level", [UserLevel.DIVISION_MANAGER, UserLevel.DEPARTMENT_MANAGER])
async def test_a_high_business_level_alone_does_not_open_the_hr_module(
    client: AsyncClient, migrated_database_url: str, level: UserLevel
) -> None:
    # Levels are about assigning work, not about permissions (docs/usecases.md).
    await create_user(migrated_database_url, employee_code="MGR", level=level)
    headers = await login_as(client, "MGR")
    assert_problem(await client.get("/api/v1/users", headers=headers), 403)


async def test_a_member_cannot_promote_themselves(
    client: AsyncClient, migrated_database_url: str
) -> None:
    emp = await create_user(migrated_database_url, employee_code="EMP")
    headers = await login_as(client, "EMP")

    response = await client.patch(
        f"/api/v1/users/{emp}", json={"level": "admin", "org_role": "admin"}, headers=headers
    )

    assert_problem(response, 403)
    rows = await db_fetch(
        migrated_database_url, "SELECT org_role, level FROM users WHERE id = $1", emp
    )
    assert (rows[0]["org_role"], rows[0]["level"]) == ("member", "employee")


async def test_me_is_open_to_every_signed_in_user(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url, employee_code="EMP")
    headers = await login_as(client, "EMP")
    assert (await client.get("/api/v1/users/me", headers=headers)).status_code == 200


# --- creating employees ----------------------------------------------------------------------


async def test_admin_creates_an_employee_with_a_personal_workspace(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    headers = await login_as(client, "ADMIN")

    response = await client.post("/api/v1/users", json=NEW_USER, headers=headers)

    assert response.status_code == 201
    body = response.json()
    assert response.headers["location"] == f"/api/v1/users/{body['id']}"
    assert body["employee_code"] == "NV100"
    assert (body["org_role"], body["level"], body["status"]) == ("member", "employee", "active")
    assert "password" not in response.text.lower().replace("must_change_password", "")

    rows = await db_fetch(
        migrated_database_url, "SELECT password_hash FROM users WHERE employee_code = 'NV100'"
    )
    assert rows[0]["password_hash"].startswith("$argon2id$")
    assert NEW_USER["password"] not in rows[0]["password_hash"]

    workspaces = await db_fetch(
        migrated_database_url,
        "SELECT w.kind, m.role FROM workspaces w"
        " JOIN workspace_members m ON m.workspace_id = w.id WHERE w.owner_user_id = $1",
        uuid.UUID(body["id"]),
    )
    assert [(r["kind"], r["role"]) for r in workspaces] == [("personal", "admin")]

    # The new employee can sign in with the password the admin chose.
    assert (await login(client, "NV100", NEW_USER["password"])).status_code == 201


async def test_duplicate_employee_code_is_409(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    headers = await login_as(client, "ADMIN")
    assert (await client.post("/api/v1/users", json=NEW_USER, headers=headers)).status_code == 201

    again = await client.post("/api/v1/users", json=NEW_USER, headers=headers)
    padded = await client.post(
        "/api/v1/users", json={**NEW_USER, "employee_code": "  NV100 "}, headers=headers
    )

    assert_problem(again, 409)
    assert_problem(padded, 409)
    rows = await db_fetch(
        migrated_database_url, "SELECT 1 FROM users WHERE employee_code = 'NV100'"
    )
    assert len(rows) == 1


async def test_two_admins_creating_the_same_code_at_once_leave_one_account(
    migrated_database_url: str,
) -> None:
    import asyncio

    from tests.helpers import app_client

    await make_admin(migrated_database_url)
    async with app_client(migrated_database_url) as client:
        headers = await login_as(client, "ADMIN")
        results = await asyncio.gather(
            *(client.post("/api/v1/users", json=NEW_USER, headers=headers) for _ in range(4))
        )
    assert sorted(r.status_code for r in results) == [201, 409, 409, 409]
    assert (
        len(
            await db_fetch(migrated_database_url, "SELECT 1 FROM users WHERE employee_code='NV100'")
        )
        == 1
    )


async def test_a_missing_employee_code_is_generated_as_the_next_nv_number(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    await create_user(migrated_database_url, employee_code="NV101")
    await create_user(migrated_database_url, employee_code="NV7")
    await create_user(migrated_database_url, employee_code="NVX9")  # not a number: ignored
    headers = await login_as(client, "ADMIN")
    without_code = {k: v for k, v in NEW_USER.items() if k != "employee_code"}

    first = await client.post("/api/v1/users", json=without_code, headers=headers)
    second = await client.post(
        "/api/v1/users", json={**without_code, "employee_code": None}, headers=headers
    )

    assert first.status_code == 201
    assert first.json()["employee_code"] == "NV102"
    assert second.status_code == 201
    assert second.json()["employee_code"] == "NV103"


async def test_the_first_generated_code_is_nv001(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    headers = await login_as(client, "ADMIN")
    without_code = {k: v for k, v in NEW_USER.items() if k != "employee_code"}

    response = await client.post("/api/v1/users", json=without_code, headers=headers)

    assert response.json()["employee_code"] == "NV001"


async def test_generated_codes_never_collide_when_admins_add_people_at_once(
    migrated_database_url: str,
) -> None:
    import asyncio

    from tests.helpers import app_client

    await make_admin(migrated_database_url)
    without_code = {k: v for k, v in NEW_USER.items() if k != "employee_code"}
    async with app_client(migrated_database_url) as client:
        headers = await login_as(client, "ADMIN")
        results = await asyncio.gather(
            *(client.post("/api/v1/users", json=without_code, headers=headers) for _ in range(4))
        )
    assert [r.status_code for r in results] == [201, 201, 201, 201]
    assert sorted(r.json()["employee_code"] for r in results) == [
        "NV001",
        "NV002",
        "NV003",
        "NV004",
    ]


@pytest.mark.parametrize(
    ("override", "reason"),
    [
        ({"org_role": "owner"}, "owner cannot be assigned through the API"),
        ({"level": "admin"}, "level admin needs role admin"),
        ({"org_role": "admin"}, "role admin needs level admin"),
        ({"password": "short"}, "password too short"),
        ({"password": "x" * 129}, "password too long"),
        ({"employee_code": "   "}, "blank code"),
        ({"level": "boss"}, "unknown level"),
        ({"department_id": str(uuid.uuid4())}, "department does not exist"),
        ({"manager_id": str(uuid.uuid4())}, "manager does not exist"),
        ({"id": str(uuid.uuid4())}, "unknown field id"),
        ({"password_hash": "x"}, "unknown field password_hash"),
        ({"status": "disabled"}, "unknown field status"),
    ],
)
async def test_invalid_creation_is_422_and_creates_nothing(
    client: AsyncClient,
    migrated_database_url: str,
    override: dict[str, object],
    reason: str,
) -> None:
    await make_admin(migrated_database_url)
    headers = await login_as(client, "ADMIN")

    response = await client.post("/api/v1/users", json={**NEW_USER, **override}, headers=headers)

    assert_problem(response, 422)  # reason is documented by the parameter id
    assert NEW_USER["password"] not in response.text
    assert (
        await db_fetch(migrated_database_url, "SELECT 1 FROM users WHERE employee_code='NV100'")
        == []
    )


async def test_a_disabled_employee_cannot_be_chosen_as_manager(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    boss = await create_user(
        migrated_database_url, employee_code="OLDBOSS", status=UserStatus.DISABLED
    )
    headers = await login_as(client, "ADMIN")
    response = await client.post(
        "/api/v1/users", json={**NEW_USER, "manager_id": str(boss)}, headers=headers
    )
    assert_problem(response, 422)


async def test_references_from_another_organization_are_rejected(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    other = await create_other_organization(migrated_database_url)
    headers = await login_as(client, "ADMIN")

    with_dept = await client.post(
        "/api/v1/users",
        json={**NEW_USER, "department_id": str(other["department_id"])},
        headers=headers,
    )
    with_manager = await client.post(
        "/api/v1/users",
        json={**NEW_USER, "manager_id": str(other["user_id"])},
        headers=headers,
    )

    assert_problem(with_dept, 422)
    assert_problem(with_manager, 422)


async def test_the_same_code_may_exist_in_another_organization(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    await create_other_organization(migrated_database_url)  # has an employee "OTHER1"
    headers = await login_as(client, "ADMIN")
    response = await client.post(
        "/api/v1/users", json={**NEW_USER, "employee_code": "OTHER1"}, headers=headers
    )
    assert response.status_code == 201


# --- listing and reading ---------------------------------------------------------------------


async def _seed_employees(url: str, count: int) -> None:
    for i in range(1, count + 1):
        await create_user(url, employee_code=f"U{i:02d}", full_name=f"Employee {i}")


async def test_list_is_paginated_by_cursor_without_gaps_or_repeats(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    await _seed_employees(migrated_database_url, 5)
    headers = await login_as(client, "ADMIN")

    seen: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params: dict[str, str | int] = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        body = (await client.get("/api/v1/users", params=params, headers=headers)).json()
        seen += [item["employee_code"] for item in body["items"]]
        pages += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert seen == ["ADMIN", "U01", "U02", "U03", "U04", "U05"]
    assert pages == 3


async def test_list_search_filters_and_is_not_fooled_by_wildcards(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    await create_user(migrated_database_url, employee_code="A1", full_name="Tran Thi Mai")
    await create_user(migrated_database_url, employee_code="A2", full_name="100% effort")
    await create_user(
        migrated_database_url, employee_code="A3", full_name="Off", status=UserStatus.DISABLED
    )
    headers = await login_as(client, "ADMIN")

    async def codes(**params: str) -> list[str]:
        response = await client.get("/api/v1/users", params=params, headers=headers)
        assert response.status_code == 200
        return [item["employee_code"] for item in response.json()["items"]]

    assert await codes(q="mai") == ["A1"]  # case-insensitive, matches the name
    assert await codes(q="a2") == ["A2"]  # matches the code
    assert await codes(q="%") == ["A2"]  # a literal percent sign, not "match everything"
    assert await codes(q="_") == []  # a literal underscore
    assert await codes(status="disabled") == ["A3"]


async def test_list_only_shows_the_admins_own_organization(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    await create_other_organization(migrated_database_url)
    headers = await login_as(client, "ADMIN")
    body = (await client.get("/api/v1/users", headers=headers)).json()
    assert [item["employee_code"] for item in body["items"]] == ["ADMIN"]


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 101}, {"cursor": "%%%not-base64"}, {"status": "gone"}]
)
async def test_list_rejects_bad_parameters(
    client: AsyncClient, migrated_database_url: str, params: dict[str, Any]
) -> None:
    await make_admin(migrated_database_url)
    headers = await login_as(client, "ADMIN")
    assert_problem(await client.get("/api/v1/users", params=params, headers=headers), 422)


async def test_get_unknown_or_foreign_user_is_404(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    other = await create_other_organization(migrated_database_url)
    headers = await login_as(client, "ADMIN")

    assert_problem(await client.get(f"/api/v1/users/{uuid.uuid4()}", headers=headers), 404)
    # Guessing the id of an employee of another company reveals nothing.
    assert_problem(await client.get(f"/api/v1/users/{other['user_id']}", headers=headers), 404)
    assert_problem(await client.get("/api/v1/users/not-a-uuid", headers=headers), 422)


# --- editing ---------------------------------------------------------------------------------


async def test_admin_updates_an_employee(client: AsyncClient, migrated_database_url: str) -> None:
    await make_admin(migrated_database_url)
    emp = await create_user(migrated_database_url, employee_code="EMP")
    boss = await create_user(migrated_database_url, employee_code="BOSS")
    headers = await login_as(client, "ADMIN")

    response = await client.patch(
        f"/api/v1/users/{emp}",
        json={"full_name": "  New Name ", "level": "department_manager", "manager_id": str(boss)},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["full_name"] == "New Name"
    assert body["level"] == "department_manager"
    assert body["manager_id"] == str(boss)

    cleared = await client.patch(f"/api/v1/users/{emp}", json={"manager_id": None}, headers=headers)
    assert cleared.json()["manager_id"] is None


async def test_patch_cannot_touch_fields_that_are_not_editable(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    emp = await create_user(migrated_database_url, employee_code="EMP")
    headers = await login_as(client, "ADMIN")

    for forbidden in (
        {"password": "Hijacked-Pass-1"},
        {"password_hash": "x"},
        {"employee_code": "STOLEN"},
        {"id": str(uuid.uuid4())},
        {"organization_id": str(uuid.uuid4())},
        {"org_role": "owner"},
    ):
        response = await client.patch(f"/api/v1/users/{emp}", json=forbidden, headers=headers)
        assert_problem(response, 422)

    # The employee still signs in with the original password and code.
    assert (await login(client, "EMP", PASSWORD)).status_code == 201


@pytest.mark.parametrize(
    "payload",
    [{"level": None}, {"org_role": None}, {"status": None}, {"full_name": None}, {"full_name": ""}],
)
async def test_required_fields_cannot_be_cleared(
    client: AsyncClient, migrated_database_url: str, payload: dict[str, object]
) -> None:
    await make_admin(migrated_database_url)
    emp = await create_user(migrated_database_url, employee_code="EMP")
    headers = await login_as(client, "ADMIN")
    assert_problem(await client.patch(f"/api/v1/users/{emp}", json=payload, headers=headers), 422)


async def test_manager_loops_are_refused(client: AsyncClient, migrated_database_url: str) -> None:
    await make_admin(migrated_database_url)
    a = await create_user(migrated_database_url, employee_code="A")
    b = await create_user(migrated_database_url, employee_code="B", manager_id=a)
    c = await create_user(migrated_database_url, employee_code="C", manager_id=b)
    headers = await login_as(client, "ADMIN")

    # A -> manager C would close the loop A <- B <- C <- A.
    assert_problem(
        await client.patch(f"/api/v1/users/{a}", json={"manager_id": str(c)}, headers=headers), 422
    )
    assert_problem(
        await client.patch(f"/api/v1/users/{a}", json={"manager_id": str(a)}, headers=headers), 422
    )
    # A legitimate change still works.
    ok = await client.patch(f"/api/v1/users/{c}", json={"manager_id": str(a)}, headers=headers)
    assert ok.status_code == 200


async def test_disabling_revokes_sessions_and_blocks_login(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    emp = await create_user(migrated_database_url, employee_code="EMP")
    admin_headers = await login_as(client, "ADMIN")
    emp_headers = await login_as(client, "EMP")
    assert (await client.get("/api/v1/users/me", headers=emp_headers)).status_code == 200

    response = await client.patch(
        f"/api/v1/users/{emp}", json={"status": "disabled"}, headers=admin_headers
    )

    assert response.status_code == 200
    # The token the employee already holds stops working at once...
    assert_problem(await client.get("/api/v1/users/me", headers=emp_headers), 401)
    # ...and a new login is refused, with the same answer as a wrong password.
    assert_problem(await login(client, "EMP", PASSWORD), 401)

    # Enabling again allows a new login, but the old token stays dead.
    await client.patch(f"/api/v1/users/{emp}", json={"status": "active"}, headers=admin_headers)
    assert_problem(await client.get("/api/v1/users/me", headers=emp_headers), 401)
    assert (await login(client, "EMP", PASSWORD)).status_code == 201


async def test_admin_cannot_change_their_own_role_or_status(
    client: AsyncClient, migrated_database_url: str
) -> None:
    admin = await make_admin(migrated_database_url)
    headers = await login_as(client, "ADMIN")

    for payload in ({"status": "disabled"}, {"level": "employee", "org_role": "member"}):
        response = await client.patch(f"/api/v1/users/{admin}", json=payload, headers=headers)
        assert_problem(response, 409)

    # They can still edit their own name.
    ok = await client.patch(
        f"/api/v1/users/{admin}", json={"full_name": "Renamed"}, headers=headers
    )
    assert ok.status_code == 200


async def test_the_owner_is_protected_from_other_admins(
    client: AsyncClient, migrated_database_url: str
) -> None:
    owner = await make_owner(migrated_database_url)
    await make_admin(migrated_database_url)
    admin_headers = await login_as(client, "ADMIN")
    owner_headers = await login_as(client, "OWNER")

    for payload in ({"status": "disabled"}, {"full_name": "Taken over"}, {"level": "employee"}):
        response = await client.patch(f"/api/v1/users/{owner}", json=payload, headers=admin_headers)
        assert_problem(response, 403)

    # The owner may rename themselves, but cannot change their own role or status.
    assert (
        await client.patch(
            f"/api/v1/users/{owner}", json={"full_name": "Boss"}, headers=owner_headers
        )
    ).status_code == 200
    assert_problem(
        await client.patch(
            f"/api/v1/users/{owner}", json={"status": "disabled"}, headers=owner_headers
        ),
        403,
    )
    assert (await client.get("/api/v1/users/me", headers=owner_headers)).status_code == 200


async def test_patching_a_foreign_user_is_404_and_changes_nothing(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    other = await create_other_organization(migrated_database_url)
    headers = await login_as(client, "ADMIN")

    response = await client.patch(
        f"/api/v1/users/{other['user_id']}", json={"status": "disabled"}, headers=headers
    )

    assert_problem(response, 404)
    rows = await db_fetch(
        migrated_database_url, "SELECT status FROM users WHERE id = $1", other["user_id"]
    )
    assert rows[0]["status"] == "active"


async def test_a_new_session_cookie_is_not_needed_to_see_the_token_is_hidden(
    client: AsyncClient, migrated_database_url: str
) -> None:
    # The token must never appear in any response body, including the HR listing.
    await make_admin(migrated_database_url)
    response = await login(client, "ADMIN")
    token = session_cookie(response)
    listing = await client.get("/api/v1/users", headers=with_cookie(token))
    assert token not in listing.text
