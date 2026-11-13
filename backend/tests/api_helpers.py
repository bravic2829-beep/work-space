"""Small helpers shared by the API tests."""

import re

import asyncpg
from httpx import AsyncClient, Response

from tests.factories import PASSWORD
from tests.helpers import asyncpg_dsn

COOKIE_NAME = "workbase_session"


def session_cookie(response: Response) -> str:
    """The token from the Set-Cookie header of a login response."""
    match = re.search(rf"{COOKIE_NAME}=([^;]+)", response.headers["set-cookie"])
    assert match, response.headers.get("set-cookie")
    return match.group(1)


def with_cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"{COOKIE_NAME}={token}"}


async def login(
    client: AsyncClient,
    code: str = "E001",
    password: str = PASSWORD,
    *,
    remember_me: bool = False,
) -> Response:
    return await client.post(
        "/api/v1/sessions",
        json={"employee_code": code, "password": password, "remember_me": remember_me},
    )


async def login_as(client: AsyncClient, code: str, password: str = PASSWORD) -> dict[str, str]:
    """Sign in and return the Cookie header to send on later requests."""
    response = await login(client, code, password)
    assert response.status_code == 201, response.text
    return with_cookie(session_cookie(response))


async def db_fetch(url: str, sql: str, *args: object) -> list[asyncpg.Record]:
    conn = await asyncpg.connect(asyncpg_dsn(url), timeout=5)
    try:
        rows: list[asyncpg.Record] = await conn.fetch(sql, *args)
        return rows
    finally:
        await conn.close()


def assert_problem(response: Response, status: int) -> dict[str, object]:
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body: dict[str, object] = response.json()
    assert body["status"] == status
    assert body["type"] == "about:blank"
    return body


async def db_execute(url: str, sql: str, *args: object) -> None:
    conn = await asyncpg.connect(asyncpg_dsn(url), timeout=5)
    try:
        await conn.execute(sql, *args)
    finally:
        await conn.close()
