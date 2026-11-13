"""A ready-made organization for the Phase 3 tests (bases, tables, fields, records)."""

import uuid
from typing import Any

from httpx import AsyncClient

from app.modules.users.models import OrgRole, UserLevel
from tests.api_helpers import login_as
from tests.factories import create_other_organization, create_user, session_for_user


class Work:
    """People and one shared workspace.

    - admin: organization admin (sees and edits everything).
    - wsadmin, editor, commenter, viewer: members of the shared workspace with that role.
    - member: an employee who is NOT in the workspace (sees only what is assigned to them).
    - member2: another employee outside the workspace.
    - other_admin: admin of a different organization.
    """

    NAMES = ("wsadmin", "editor", "commenter", "viewer", "member", "member2")

    def __init__(self, client: AsyncClient) -> None:
        self.client = client
        self.users: dict[str, uuid.UUID] = {}
        self.h: dict[str, dict[str, str]] = {}
        self.workspace_id = ""
        self.other: dict[str, uuid.UUID] = {}

    async def api(
        self,
        method: str,
        url: str,
        who: str = "admin",
        *,
        json: Any = None,
        headers: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        merged = {**self.h.get(who, {}), **(headers or {})}
        return await self.client.request(
            method, f"/api/v1{url}", json=json, headers=merged, params=params
        )

    async def make_base(self, name: str = "Projects", who: str = "admin") -> str:
        response = await self.api(
            "POST", f"/workspaces/{self.workspace_id}/bases", who, json={"name": name}
        )
        assert response.status_code == 201, response.text
        return str(response.json()["id"])

    async def make_table(
        self, base_id: str, name: str = "Tasks", template: str = "blank", who: str = "admin"
    ) -> dict[str, Any]:
        response = await self.api(
            "POST", f"/bases/{base_id}/tables", who, json={"name": name, "template": template}
        )
        assert response.status_code == 201, response.text
        body: dict[str, Any] = response.json()
        return body

    async def make_field(
        self, table_id: str, name: str, field_type: str, who: str = "admin", **extra: Any
    ) -> dict[str, Any]:
        response = await self.api(
            "POST",
            f"/tables/{table_id}/fields",
            who,
            json={"name": name, "type": field_type, **extra},
        )
        assert response.status_code == 201, response.text
        body: dict[str, Any] = response.json()
        return body


async def build_work(client: AsyncClient, database_url: str) -> Work:
    work = Work(client)
    work.users["admin"] = await create_user(
        database_url, employee_code="ADMIN", level=UserLevel.ADMIN, org_role=OrgRole.ADMIN
    )
    for name in Work.NAMES:
        work.users[name] = await create_user(database_url, employee_code=name.upper())
    work.other = await create_other_organization(database_url)

    work.h["admin"] = await login_as(client, "ADMIN")
    created = await work.api("POST", "/workspaces", json={"name": "Projects"})
    assert created.status_code == 201
    work.workspace_id = created.json()["id"]
    for name, role in (
        ("wsadmin", "admin"),
        ("editor", "editor"),
        ("commenter", "commenter"),
        ("viewer", "viewer"),
    ):
        added = await work.api(
            "POST",
            f"/workspaces/{work.workspace_id}/members",
            json={"user_id": str(work.users[name]), "role": role},
        )
        assert added.status_code == 201, added.text
    for name in Work.NAMES:
        work.h[name] = await login_as(client, name.upper())
    work.h["other_admin"] = await session_for_user(database_url, work.other["user_id"])
    # Logins leave cookies in the client. Clear them so that a request without headers is
    # really anonymous and every request names who is calling.
    client.cookies.clear()
    return work
