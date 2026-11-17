"""Changing my own password: PUT /users/me/password."""

from collections.abc import AsyncIterator

import pytest
from httpx import AsyncClient

from tests.api_helpers import assert_problem, db_fetch, login, login_as
from tests.factories import PASSWORD, create_user
from tests.helpers import app_client

NEW_PASSWORD = "Brand-New-Pass-2"
URL = "/api/v1/users/me/password"


@pytest.fixture
async def client(migrated_database_url: str) -> AsyncIterator[AsyncClient]:
    async with app_client(migrated_database_url, login_max_failures=3) as c:
        yield c


def body(current: str = PASSWORD, new: str = NEW_PASSWORD) -> dict[str, str]:
    return {"current_password": current, "new_password": new}


async def test_the_new_password_works_and_the_old_one_does_not(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    headers = await login_as(client, "E001")

    response = await client.put(URL, json=body(), headers=headers)

    assert response.status_code == 204
    assert (await login(client, "E001", NEW_PASSWORD)).status_code == 201
    assert_problem(await login(client, "E001", PASSWORD), 401)
    rows = await db_fetch(
        migrated_database_url, "SELECT password_hash FROM users WHERE employee_code = 'E001'"
    )
    assert rows[0]["password_hash"].startswith("$argon2id$")
    assert NEW_PASSWORD not in rows[0]["password_hash"]


async def test_this_session_stays_signed_in_but_other_devices_are_signed_out(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    this_device = await login_as(client, "E001")
    other_device = await login_as(client, "E001")

    assert (await client.put(URL, json=body(), headers=this_device)).status_code == 204

    assert (await client.get("/api/v1/users/me", headers=this_device)).status_code == 200
    assert_problem(await client.get("/api/v1/users/me", headers=other_device), 401)


async def test_a_wrong_current_password_is_403_and_changes_nothing(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    headers = await login_as(client, "E001")

    response = await client.put(URL, json=body(current="not-my-password"), headers=headers)

    assert_problem(response, 403)
    assert "not-my-password" not in response.text
    assert (await login(client, "E001", PASSWORD)).status_code == 201


async def test_guessing_the_current_password_is_rate_limited(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    headers = await login_as(client, "E001")

    for _ in range(3):
        assert_problem(await client.put(URL, json=body(current="nope-nope"), headers=headers), 403)
    locked = await client.put(URL, json=body(), headers=headers)

    assert_problem(locked, 429)
    assert "retry-after" in locked.headers


@pytest.mark.parametrize(
    ("payload", "reason"),
    [
        (body(new="short"), "new password too short"),
        (body(new="x" * 129), "new password too long"),
        (body(new=PASSWORD), "same as the current password"),
        ({"current_password": PASSWORD}, "new password missing"),
        ({"new_password": NEW_PASSWORD}, "current password missing"),
        ({**body(), "employee_code": "E002"}, "unknown field"),
    ],
)
async def test_invalid_requests_are_422_and_change_nothing(
    client: AsyncClient,
    migrated_database_url: str,
    payload: dict[str, str],
    reason: str,
) -> None:
    await create_user(migrated_database_url)
    headers = await login_as(client, "E001")

    response = await client.put(URL, json=payload, headers=headers)

    assert_problem(response, 422)  # reason is documented by the parameter id
    assert (await login(client, "E001", PASSWORD)).status_code == 201


async def test_it_needs_a_login(client: AsyncClient, migrated_database_url: str) -> None:
    await create_user(migrated_database_url)
    assert_problem(await client.put(URL, json=body()), 401)


async def test_it_only_ever_changes_my_own_password(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url, employee_code="E001")
    await create_user(migrated_database_url, employee_code="E002")
    headers = await login_as(client, "E001")

    assert (await client.put(URL, json=body(), headers=headers)).status_code == 204

    assert (await login(client, "E002", PASSWORD)).status_code == 201


# --- an admin resets a forgotten password -----------------------------------------------------

TEMP_PASSWORD = "Temp-Pass-12345"


async def make_admin(url: str) -> None:
    from app.modules.users.models import OrgRole, UserLevel

    await create_user(url, employee_code="ADMIN", level=UserLevel.ADMIN, org_role=OrgRole.ADMIN)


async def test_an_admin_resets_a_password_and_the_employee_must_change_it(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await make_admin(migrated_database_url)
    employee = await create_user(migrated_database_url, employee_code="E001")
    admin_headers = await login_as(client, "ADMIN")
    old_session = await login_as(client, "E001")

    response = await client.put(
        f"/api/v1/users/{employee}/password",
        json={"new_password": TEMP_PASSWORD},
        headers=admin_headers,
    )

    assert response.status_code == 204
    # Signed out everywhere, and the old password is gone.
    assert_problem(await client.get("/api/v1/users/me", headers=old_session), 401)
    assert_problem(await login(client, "E001", PASSWORD), 401)

    temp = await login_as(client, "E001", TEMP_PASSWORD)
    me = await client.get("/api/v1/users/me", headers=temp)
    assert me.status_code == 200
    assert me.json()["must_change_password"] is True
    # Nothing else is open until the password is changed.
    assert_problem(await client.get("/api/v1/me/tasks", headers=temp), 403)
    assert_problem(await client.get("/api/v1/workspaces", headers=temp), 403)

    changed = await client.put(
        URL, json=body(current=TEMP_PASSWORD, new=NEW_PASSWORD), headers=temp
    )
    assert changed.status_code == 204
    assert (await client.get("/api/v1/workspaces", headers=temp)).status_code == 200
    me = await client.get("/api/v1/users/me", headers=temp)
    assert me.json()["must_change_password"] is False
    assert (await login(client, "E001", NEW_PASSWORD)).status_code == 201


async def test_a_plain_employee_cannot_reset_anyones_password(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url, employee_code="E001")
    other = await create_user(migrated_database_url, employee_code="E002")
    headers = await login_as(client, "E001")

    response = await client.put(
        f"/api/v1/users/{other}/password", json={"new_password": TEMP_PASSWORD}, headers=headers
    )

    assert_problem(response, 403)
    assert (await login(client, "E002", PASSWORD)).status_code == 201


async def test_reset_needs_a_login(client: AsyncClient, migrated_database_url: str) -> None:
    other = await create_user(migrated_database_url, employee_code="E002")
    response = await client.put(
        f"/api/v1/users/{other}/password", json={"new_password": TEMP_PASSWORD}
    )
    assert_problem(response, 401)


async def test_the_owner_and_yourself_cannot_be_reset(
    client: AsyncClient, migrated_database_url: str
) -> None:
    from app.modules.users.models import OrgRole, UserLevel

    admin = await create_user(
        migrated_database_url,
        employee_code="ADMIN",
        level=UserLevel.ADMIN,
        org_role=OrgRole.ADMIN,
    )
    owner = await create_user(
        migrated_database_url,
        employee_code="OWNER",
        level=UserLevel.ADMIN,
        org_role=OrgRole.OWNER,
    )
    headers = await login_as(client, "ADMIN")
    payload = {"new_password": TEMP_PASSWORD}

    assert_problem(
        await client.put(f"/api/v1/users/{owner}/password", json=payload, headers=headers), 403
    )
    assert_problem(
        await client.put(f"/api/v1/users/{admin}/password", json=payload, headers=headers), 409
    )
    assert (await login(client, "OWNER", PASSWORD)).status_code == 201


async def test_reset_validates_the_password_and_the_target(
    client: AsyncClient, migrated_database_url: str
) -> None:
    import uuid

    await make_admin(migrated_database_url)
    employee = await create_user(migrated_database_url, employee_code="E001")
    headers = await login_as(client, "ADMIN")

    short = await client.put(
        f"/api/v1/users/{employee}/password", json={"new_password": "short"}, headers=headers
    )
    extra = await client.put(
        f"/api/v1/users/{employee}/password",
        json={"new_password": TEMP_PASSWORD, "must_change_password": False},
        headers=headers,
    )
    unknown = await client.put(
        f"/api/v1/users/{uuid.uuid4()}/password",
        json={"new_password": TEMP_PASSWORD},
        headers=headers,
    )

    assert_problem(short, 422)
    assert_problem(extra, 422)
    assert_problem(unknown, 404)
    assert (await login(client, "E001", PASSWORD)).status_code == 201


async def test_a_reset_cannot_touch_another_organization(
    client: AsyncClient, migrated_database_url: str
) -> None:
    from tests.factories import create_other_organization

    await make_admin(migrated_database_url)
    outsider = await create_other_organization(migrated_database_url)
    headers = await login_as(client, "ADMIN")

    response = await client.put(
        f"/api/v1/users/{outsider['user_id']}/password",
        json={"new_password": TEMP_PASSWORD},
        headers=headers,
    )

    assert_problem(response, 404)
