import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.users.models import OrgRole, UserLevel, UserStatus
from tests.api_helpers import assert_problem, login_as
from tests.factories import create_other_organization, create_user


@pytest.fixture
async def admin_headers(client: AsyncClient, migrated_database_url: str) -> dict[str, str]:
    await create_user(
        migrated_database_url, employee_code="ADMIN", level=UserLevel.ADMIN, org_role=OrgRole.ADMIN
    )
    return await login_as(client, "ADMIN")


async def create(
    client: AsyncClient, headers: dict[str, str], name: str, kind: str, parent_id: Any = None
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/departments",
        json={"name": name, "kind": kind, "parent_id": parent_id},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_admin_creates_reads_updates_and_deletes_a_department(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    division = await create(client, admin_headers, "  Sales  ", "division")
    assert division["name"] == "Sales"
    assert division["parent_id"] is None

    response = await client.post(
        "/api/v1/departments",
        json={"name": "Team A", "kind": "department", "parent_id": division["id"]},
        headers=admin_headers,
    )
    assert response.status_code == 201
    team = response.json()
    assert response.headers["location"] == f"/api/v1/departments/{team['id']}"
    assert team["parent_id"] == division["id"]

    listing = await client.get("/api/v1/departments", headers=admin_headers)
    assert {d["name"] for d in listing.json()} == {"Sales", "Team A"}

    got = await client.get(f"/api/v1/departments/{team['id']}", headers=admin_headers)
    assert got.json()["name"] == "Team A"

    renamed = await client.patch(
        f"/api/v1/departments/{team['id']}", json={"name": "Team B"}, headers=admin_headers
    )
    assert renamed.json()["name"] == "Team B"

    deleted = await client.delete(f"/api/v1/departments/{team['id']}", headers=admin_headers)
    assert deleted.status_code == 204
    assert_problem(
        await client.get(f"/api/v1/departments/{team['id']}", headers=admin_headers), 404
    )


async def test_hierarchy_rules(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    division = await create(client, admin_headers, "Sales", "division")
    team = await create(client, admin_headers, "Team A", "department", division["id"])

    async def post(body: dict[str, Any]) -> int:
        response = await client.post("/api/v1/departments", json=body, headers=admin_headers)
        return response.status_code

    # A division sits at the top.
    assert await post({"name": "D2", "kind": "division", "parent_id": division["id"]}) == 422
    # A department goes under a division, not under another department.
    assert await post({"name": "T2", "kind": "department", "parent_id": team["id"]}) == 422
    # The parent must exist.
    assert await post({"name": "T3", "kind": "department", "parent_id": str(uuid.uuid4())}) == 422
    # A department may also stand alone.
    assert await post({"name": "Standalone", "kind": "department"}) == 201


async def test_sibling_names_must_differ_ignoring_case(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    sales = await create(client, admin_headers, "Sales", "division")
    ops = await create(client, admin_headers, "Operations", "division")
    await create(client, admin_headers, "Team A", "department", sales["id"])

    duplicate = await client.post(
        "/api/v1/departments",
        json={"name": "team a", "kind": "department", "parent_id": sales["id"]},
        headers=admin_headers,
    )
    assert_problem(duplicate, 409)
    assert_problem(
        await client.post(
            "/api/v1/departments", json={"name": "SALES", "kind": "division"}, headers=admin_headers
        ),
        409,
    )
    # The same name is fine under another division.
    await create(client, admin_headers, "Team A", "department", ops["id"])


async def test_update_rules(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    sales = await create(client, admin_headers, "Sales", "division")
    ops = await create(client, admin_headers, "Operations", "division")
    team = await create(client, admin_headers, "Team A", "department", sales["id"])
    other = await create(client, admin_headers, "Team B", "department", sales["id"])

    moved = await client.patch(
        f"/api/v1/departments/{team['id']}", json={"parent_id": ops["id"]}, headers=admin_headers
    )
    assert moved.json()["parent_id"] == ops["id"]

    def patch(department: dict[str, Any], body: dict[str, Any]) -> Any:
        return client.patch(
            f"/api/v1/departments/{department['id']}", json=body, headers=admin_headers
        )

    assert_problem(await patch(sales, {"parent_id": ops["id"]}), 422)  # a division stays on top
    assert_problem(await patch(team, {"parent_id": other["id"]}), 422)  # not under a department
    assert_problem(await patch(team, {"name": None}), 422)
    assert_problem(await patch(team, {"name": ""}), 422)
    assert_problem(await patch(team, {"kind": "division"}), 422)  # the kind is not editable
    # Renaming into the name of a sibling is a conflict.
    sibling = await create(client, admin_headers, "Team C", "department", ops["id"])
    assert_problem(await patch(sibling, {"name": "team a"}), 409)


async def test_cannot_delete_a_department_that_is_still_in_use(
    client: AsyncClient, admin_headers: dict[str, str], migrated_database_url: str
) -> None:
    division = await create(client, admin_headers, "Sales", "division")
    team = await create(client, admin_headers, "Team A", "department", division["id"])
    await create_user(
        migrated_database_url, employee_code="EMP", department_id=uuid.UUID(team["id"])
    )

    # The division still has a sub-department, the team still has an employee.
    assert_problem(
        await client.delete(f"/api/v1/departments/{division['id']}", headers=admin_headers), 409
    )
    assert_problem(
        await client.delete(f"/api/v1/departments/{team['id']}", headers=admin_headers), 409
    )

    still_there = await client.get("/api/v1/departments", headers=admin_headers)
    assert len(still_there.json()) == 2


async def test_a_department_says_how_many_employees_it_has(
    client: AsyncClient, admin_headers: dict[str, str], migrated_database_url: str
) -> None:
    division = await create(client, admin_headers, "Sales", "division")
    team = await create(client, admin_headers, "Team A", "department", division["id"])
    assert team["member_count"] == 0
    for code, status in (("E1", UserStatus.ACTIVE), ("E2", UserStatus.DISABLED)):
        await create_user(
            migrated_database_url,
            employee_code=code,
            status=status,
            department_id=uuid.UUID(team["id"]),
        )

    listing = (await client.get("/api/v1/departments", headers=admin_headers)).json()
    counts = {d["name"]: d["member_count"] for d in listing}
    # Disabled employees still belong to the department, so they are counted. The division has
    # no employees of its own.
    assert counts == {"Sales": 0, "Team A": 2}

    got = await client.get(f"/api/v1/departments/{team['id']}", headers=admin_headers)
    assert got.json()["member_count"] == 2
    renamed = await client.patch(
        f"/api/v1/departments/{team['id']}", json={"name": "Team B"}, headers=admin_headers
    )
    assert renamed.json()["member_count"] == 2


async def test_departments_of_another_organization_are_invisible(
    client: AsyncClient, admin_headers: dict[str, str], migrated_database_url: str
) -> None:
    other = await create_other_organization(migrated_database_url)
    foreign = f"/api/v1/departments/{other['department_id']}"

    listing = await client.get("/api/v1/departments", headers=admin_headers)
    assert listing.json() == []
    assert_problem(await client.get(foreign, headers=admin_headers), 404)
    assert_problem(
        await client.patch(foreign, json={"name": "Mine now"}, headers=admin_headers), 404
    )
    assert_problem(await client.delete(foreign, headers=admin_headers), 404)

    # It cannot be used as a parent either.
    response = await client.post(
        "/api/v1/departments",
        json={"name": "Team", "kind": "department", "parent_id": str(other["department_id"])},
        headers=admin_headers,
    )
    assert_problem(response, 422)


async def test_unknown_fields_are_refused(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/departments",
        json={"name": "Sales", "kind": "division", "organization_id": str(uuid.uuid4())},
        headers=admin_headers,
    )
    assert_problem(response, 422)


async def test_a_department_head_is_set_changed_and_cleared(
    client: AsyncClient, admin_headers: dict[str, str], migrated_database_url: str
) -> None:
    first = await create_user(migrated_database_url, employee_code="HEAD1")
    second = await create_user(migrated_database_url, employee_code="HEAD2")

    created = await client.post(
        "/api/v1/departments",
        json={"name": "Sales", "kind": "division", "head_user_id": str(first)},
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["head_user_id"] == str(first)

    def patch(body: dict[str, Any]) -> Any:
        return client.patch(
            f"/api/v1/departments/{created.json()['id']}", json=body, headers=admin_headers
        )

    # Renaming leaves the head alone.
    assert (await patch({"name": "Sales 2"})).json()["head_user_id"] == str(first)
    assert (await patch({"head_user_id": str(second)})).json()["head_user_id"] == str(second)
    assert (await patch({"head_user_id": None})).json()["head_user_id"] is None


async def test_the_head_must_be_an_active_employee_of_the_organization(
    client: AsyncClient, admin_headers: dict[str, str], migrated_database_url: str
) -> None:
    disabled = await create_user(
        migrated_database_url, employee_code="GONE", status=UserStatus.DISABLED
    )
    other = await create_other_organization(migrated_database_url)

    for head in (disabled, other["user_id"], uuid.uuid4()):
        response = await client.post(
            "/api/v1/departments",
            json={"name": f"D{head}", "kind": "division", "head_user_id": str(head)},
            headers=admin_headers,
        )
        assert_problem(response, 422)

    division = await create(client, admin_headers, "Sales", "division")
    response = await client.patch(
        f"/api/v1/departments/{division['id']}",
        json={"head_user_id": str(disabled)},
        headers=admin_headers,
    )
    assert_problem(response, 422)


async def test_only_an_admin_can_set_a_department_head(
    client: AsyncClient, admin_headers: dict[str, str], migrated_database_url: str
) -> None:
    division = await create(client, admin_headers, "Sales", "division")
    member = await create_user(migrated_database_url, employee_code="EMP")
    headers = await login_as(client, "EMP")
    response = await client.patch(
        f"/api/v1/departments/{division['id']}",
        json={"head_user_id": str(member)},
        headers=headers,
    )
    assert_problem(response, 403)
