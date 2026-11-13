import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import asyncpg
import jwt
import pytest
from httpx import AsyncClient

from app.modules.users.models import OrgRole, UserLevel, UserStatus
from tests.api_helpers import (
    COOKIE_NAME,
    assert_problem,
    db_fetch,
    login,
    session_cookie,
    with_cookie,
)
from tests.factories import PASSWORD, create_user
from tests.helpers import ALLOWED_ORIGIN, TEST_JWT_SECRET, app_client, asyncpg_dsn


@pytest.fixture
async def client(migrated_database_url: str) -> AsyncIterator[AsyncClient]:
    async with app_client(migrated_database_url) as c:
        yield c


def forged_token(
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    secret: str = TEST_JWT_SECRET,
    algorithm: str = "HS256",
    expires_in: timedelta = timedelta(hours=1),
) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "jti": str(session_id), "iat": now, "exp": now + expires_in}
    return jwt.encode(payload, secret, algorithm=algorithm)


# --- login ---------------------------------------------------------------------------------


async def test_login_succeeds_and_sets_a_safe_cookie(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url, full_name="Nguyen Van A")

    response = await login(client)

    assert response.status_code == 201
    assert response.headers["location"] == "/api/v1/sessions/current"
    body = response.json()
    assert body["employee_code"] == "E001"
    assert body["full_name"] == "Nguyen Van A"
    # Neither the hash nor the token is part of the body.
    assert "password" not in str(body).lower()
    assert session_cookie(response) not in response.text

    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "path=/" in cookie


async def test_login_trims_the_employee_code(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    assert (await login(client, "  E001  ")).status_code == 201


async def test_remember_me_changes_the_lifetime(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)

    short = await login(client)
    long = await login(client, remember_me=True)

    short_exp = jwt.decode(session_cookie(short), options={"verify_signature": False})["exp"]
    long_exp = jwt.decode(session_cookie(long), options={"verify_signature": False})["exp"]
    now = datetime.now(UTC).timestamp()
    assert abs(short_exp - (now + 12 * 3600)) < 60
    assert abs(long_exp - (now + 7 * 86400)) < 60

    rows = await db_fetch(
        migrated_database_url,
        "SELECT remember_me, expires_at FROM auth_sessions ORDER BY created_at",
    )
    assert [row["remember_me"] for row in rows] == [False, True]
    assert (
        abs((rows[1]["expires_at"] - rows[0]["expires_at"]).total_seconds() - 7 * 86400 + 12 * 3600)
        < 60
    )


async def test_login_failures_all_look_the_same(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url, employee_code="OK1")
    await create_user(migrated_database_url, employee_code="OFF1", status=UserStatus.DISABLED)

    wrong_password = await login(client, "OK1", "wrong-password")
    unknown_code = await login(client, "NOBODY", PASSWORD)
    disabled = await login(client, "OFF1", PASSWORD)  # the password is right

    for response in (wrong_password, unknown_code, disabled):
        assert_problem(response, 401)
        assert response.headers["www-authenticate"].startswith("Cookie")
        assert "set-cookie" not in response.headers
    # Same body, so nothing reveals whether a code exists or is disabled.
    assert wrong_password.json() == unknown_code.json() == disabled.json()
    assert await db_fetch(migrated_database_url, "SELECT 1 FROM auth_sessions") == []


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"employee_code": "E001"},
        {"password": "x"},
        {"employee_code": "", "password": "x"},
        {"employee_code": "E001", "password": ""},
        {"employee_code": "E001", "password": "x" * 129},
        {"employee_code": "E" * 51, "password": "x"},
    ],
)
async def test_login_validates_the_input(client: AsyncClient, payload: dict[str, object]) -> None:
    response = await client.post("/api/v1/sessions", json=payload)
    body = assert_problem(response, 422)
    assert body["errors"]


async def test_validation_errors_never_echo_the_submitted_password(client: AsyncClient) -> None:
    secret = "S" * 200
    response = await client.post(
        "/api/v1/sessions", json={"employee_code": "E001", "password": secret}
    )
    assert response.status_code == 422
    assert secret not in response.text


async def test_repeated_failures_lock_the_code_even_for_the_right_password(
    migrated_database_url: str,
) -> None:
    await create_user(migrated_database_url, employee_code="E001")
    await create_user(migrated_database_url, employee_code="E002")
    async with app_client(migrated_database_url, login_max_failures=3) as client:
        for _ in range(3):
            assert (await login(client, "E001", "wrong")).status_code == 401

        locked = await login(client, "E001", PASSWORD)
        assert_problem(locked, 429)
        assert int(locked.headers["retry-after"]) > 0

        # Another employee is not affected.
        assert (await login(client, "E002", PASSWORD)).status_code == 201


async def test_a_successful_login_resets_the_failure_count(migrated_database_url: str) -> None:
    await create_user(migrated_database_url)
    async with app_client(migrated_database_url, login_max_failures=3) as client:
        for _ in range(2):
            await login(client, "E001", "wrong")
        assert (await login(client)).status_code == 201
        for _ in range(2):
            assert (await login(client, "E001", "wrong")).status_code == 401
        assert (await login(client)).status_code == 201


async def test_codes_that_do_not_exist_are_locked_too(migrated_database_url: str) -> None:
    # Otherwise the lock itself would show which codes are real.
    async with app_client(migrated_database_url, login_max_failures=2) as client:
        await login(client, "GHOST", "x")
        await login(client, "GHOST", "x")
        assert_problem(await login(client, "GHOST", "x"), 429)


# --- using the session ---------------------------------------------------------------------


async def test_me_returns_the_signed_in_user(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(
        migrated_database_url, level=UserLevel.DEPARTMENT_MANAGER, org_role=OrgRole.MEMBER
    )
    token = session_cookie(await login(client))

    response = await client.get("/api/v1/users/me", headers=with_cookie(token))

    assert response.status_code == 200
    assert response.json()["level"] == "department_manager"
    assert "password_hash" not in response.text


async def test_me_without_a_cookie_is_401(client: AsyncClient) -> None:
    response = await client.get("/api/v1/users/me")
    assert_problem(response, 401)
    assert response.headers["www-authenticate"].startswith("Cookie")


async def test_tampered_token_is_401(client: AsyncClient, migrated_database_url: str) -> None:
    await create_user(migrated_database_url)
    token = session_cookie(await login(client))
    tampered = token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB")
    assert (await client.get("/api/v1/users/me", headers=with_cookie(tampered))).status_code == 401
    assert (await client.get("/api/v1/users/me", headers=with_cookie("garbage"))).status_code == 401


async def test_token_signed_with_another_secret_is_401(
    client: AsyncClient, migrated_database_url: str
) -> None:
    user_id = await create_user(migrated_database_url)
    await login(client)
    session_id = (await db_fetch(migrated_database_url, "SELECT id FROM auth_sessions"))[0]["id"]

    forged = forged_token(user_id=user_id, session_id=session_id, secret="x" * 40)
    assert (await client.get("/api/v1/users/me", headers=with_cookie(forged))).status_code == 401
    # The same claims signed with the real secret are accepted: only the signature differs.
    valid = forged_token(user_id=user_id, session_id=session_id)
    assert (await client.get("/api/v1/users/me", headers=with_cookie(valid))).status_code == 200


async def test_token_with_alg_none_is_401(client: AsyncClient, migrated_database_url: str) -> None:
    user_id = await create_user(migrated_database_url)
    await login(client)
    session_id = (await db_fetch(migrated_database_url, "SELECT id FROM auth_sessions"))[0]["id"]
    unsigned = jwt.encode(
        {
            "sub": str(user_id),
            "jti": str(session_id),
            "iat": datetime.now(UTC),
            "exp": datetime.now(UTC) + timedelta(hours=1),
        },
        key="",
        algorithm="none",
    )
    assert (await client.get("/api/v1/users/me", headers=with_cookie(unsigned))).status_code == 401


async def test_valid_token_without_a_session_row_is_401(
    client: AsyncClient, migrated_database_url: str
) -> None:
    user_id = await create_user(migrated_database_url)
    token = forged_token(user_id=user_id, session_id=uuid.uuid4())
    assert (await client.get("/api/v1/users/me", headers=with_cookie(token))).status_code == 401


async def test_expired_token_is_401(client: AsyncClient, migrated_database_url: str) -> None:
    user_id = await create_user(migrated_database_url)
    await login(client)
    session_id = (await db_fetch(migrated_database_url, "SELECT id FROM auth_sessions"))[0]["id"]
    expired = forged_token(user_id=user_id, session_id=session_id, expires_in=timedelta(seconds=-5))
    assert (await client.get("/api/v1/users/me", headers=with_cookie(expired))).status_code == 401


async def test_session_expired_in_the_database_is_401(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    token = session_cookie(await login(client))
    conn = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        await conn.execute("UPDATE auth_sessions SET expires_at = now() - interval '1 minute'")
    finally:
        await conn.close()
    assert (await client.get("/api/v1/users/me", headers=with_cookie(token))).status_code == 401


async def test_token_of_a_session_that_belongs_to_another_user_is_401(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url, employee_code="A")
    other_id = await create_user(migrated_database_url, employee_code="B")
    await login(client, "A")
    session_id = (await db_fetch(migrated_database_url, "SELECT id FROM auth_sessions"))[0]["id"]
    # Right signature and a real jti, but the subject is a different user.
    token = forged_token(user_id=other_id, session_id=session_id)
    assert (await client.get("/api/v1/users/me", headers=with_cookie(token))).status_code == 401


async def test_disabling_the_user_ends_their_session_immediately(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    token = session_cookie(await login(client))
    assert (await client.get("/api/v1/users/me", headers=with_cookie(token))).status_code == 200

    conn = await asyncpg.connect(asyncpg_dsn(migrated_database_url), timeout=5)
    try:
        await conn.execute("UPDATE users SET status = 'disabled'")
    finally:
        await conn.close()

    assert (await client.get("/api/v1/users/me", headers=with_cookie(token))).status_code == 401


# --- logout --------------------------------------------------------------------------------


async def test_logout_revokes_the_token_and_clears_the_cookie(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    token = session_cookie(await login(client))

    response = await client.delete("/api/v1/sessions/current", headers=with_cookie(token))

    assert response.status_code == 204
    assert response.content == b""
    cleared = response.headers["set-cookie"].lower()
    assert f"{COOKIE_NAME}=" in cleared and ("max-age=0" in cleared or "expires=" in cleared)

    # The old token, replayed, no longer works.
    assert (await client.get("/api/v1/users/me", headers=with_cookie(token))).status_code == 401
    rows = await db_fetch(migrated_database_url, "SELECT revoked_at FROM auth_sessions")
    assert rows[0]["revoked_at"] is not None


async def test_logout_only_ends_the_current_session(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    first = session_cookie(await login(client))
    second = session_cookie(await login(client))

    await client.delete("/api/v1/sessions/current", headers=with_cookie(first))

    assert (await client.get("/api/v1/users/me", headers=with_cookie(first))).status_code == 401
    assert (await client.get("/api/v1/users/me", headers=with_cookie(second))).status_code == 200


async def test_logout_without_a_session_is_401(client: AsyncClient) -> None:
    assert_problem(await client.delete("/api/v1/sessions/current"), 401)


# --- CSRF ----------------------------------------------------------------------------------


async def test_state_changing_request_from_a_foreign_origin_is_refused(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)

    response = await client.post(
        "/api/v1/sessions",
        json={"employee_code": "E001", "password": PASSWORD},
        headers={"Origin": "http://evil.example"},
    )

    assert_problem(response, 403)
    assert await db_fetch(migrated_database_url, "SELECT 1 FROM auth_sessions") == []


async def test_logout_forged_from_a_foreign_origin_does_not_revoke_the_session(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    token = session_cookie(await login(client))

    forged = await client.delete(
        "/api/v1/sessions/current",
        headers={**with_cookie(token), "Origin": "http://evil.example"},
    )

    assert_problem(forged, 403)
    assert (await client.get("/api/v1/users/me", headers=with_cookie(token))).status_code == 200


async def test_requests_from_our_own_origin_or_without_origin_are_accepted(
    client: AsyncClient, migrated_database_url: str
) -> None:
    await create_user(migrated_database_url)
    body = {"employee_code": "E001", "password": PASSWORD}
    same_origin = await client.post(
        "/api/v1/sessions", json=body, headers={"Origin": ALLOWED_ORIGIN}
    )
    assert same_origin.status_code == 201
    assert (await client.post("/api/v1/sessions", json=body)).status_code == 201


async def test_the_origin_null_is_refused(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/sessions",
        json={"employee_code": "E001", "password": "x"},
        headers={"Origin": "null"},
    )
    assert_problem(response, 403)


async def test_reading_is_not_blocked_by_the_origin_check(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health", headers={"Origin": "http://evil.example"})
    assert response.status_code == 200


# --- error format --------------------------------------------------------------------------


async def test_unknown_path_is_a_problem_details_404(client: AsyncClient) -> None:
    assert_problem(await client.get("/api/v1/nope"), 404)


async def test_wrong_method_is_a_problem_details_405(client: AsyncClient) -> None:
    assert_problem(await client.put("/api/v1/sessions", json={}), 405)


async def test_unexpected_errors_do_not_leak_details(migrated_database_url: str) -> None:
    # No JWT secret outside the test environment would break login: it must stay a plain 500.
    async with app_client(
        migrated_database_url, raise_app_exceptions=False, jwt_secret=None
    ) as client:
        await create_user(migrated_database_url)
        response = await login(client)
    body = assert_problem(response, 500)
    assert "JWT" not in response.text and "secret" not in response.text.lower()
    assert "detail" not in body
