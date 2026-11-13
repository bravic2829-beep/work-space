from typing import Any

from tests.api_helpers import assert_problem
from tests.factories import create_user
from tests.work_world import Work


async def search(work: Work, who: str = "member", **params: Any) -> Any:
    return await work.api("GET", "/directory/users", who, params=params)


async def test_any_employee_can_search_colleagues(work: Work) -> None:
    for who in ("member", "viewer", "editor", "admin"):
        response = await search(work, who)
        assert response.status_code == 200, who
        codes = {entry["employee_code"] for entry in response.json()}
        assert {"ADMIN", "VIEWER", "MEMBER"} <= codes


async def test_the_directory_shows_only_what_a_picker_needs(work: Work) -> None:
    entry = (await search(work)).json()[0]
    assert set(entry) == {"id", "employee_code", "full_name"}


async def test_search_by_code_and_by_name(work: Work, migrated_database_url: str) -> None:
    await create_user(migrated_database_url, employee_code="NV100", full_name="Le Van Cuong")
    by_code = (await search(work, q="nv10")).json()
    assert [e["employee_code"] for e in by_code] == ["NV100"]
    by_name = (await search(work, q="cuong")).json()
    assert [e["employee_code"] for e in by_name] == ["NV100"]
    assert (await search(work, q="nobody-has-this")).json() == []


async def test_wildcards_are_matched_literally(work: Work, migrated_database_url: str) -> None:
    await create_user(migrated_database_url, employee_code="A%B", full_name="Percent")
    assert [e["employee_code"] for e in (await search(work, q="%")).json()] == ["A%B"]
    assert (await search(work, q="_")).json() == []


async def test_disabled_employees_and_other_organizations_are_not_listed(
    work: Work, migrated_database_url: str
) -> None:
    from app.modules.users.models import UserStatus

    await create_user(migrated_database_url, employee_code="GONE", status=UserStatus.DISABLED)
    codes = {e["employee_code"] for e in (await search(work)).json()}
    assert "GONE" not in codes
    assert "OTHER1" not in codes


async def test_limit_and_authentication(work: Work) -> None:
    assert len((await search(work, limit=2)).json()) == 2
    assert_problem(await search(work, limit=0), 422)
    assert_problem(await search(work, limit=51), 422)
    assert_problem(await search(work, who="nobody"), 401)


async def test_another_organization_sees_only_its_own_people(work: Work) -> None:
    codes = {e["employee_code"] for e in (await search(work, "other_admin")).json()}
    assert codes == {"OTHER1"}


async def test_look_people_up_by_id_even_after_they_left(
    work: Work, migrated_database_url: str
) -> None:
    from app.modules.users.models import UserStatus

    gone = await create_user(
        migrated_database_url,
        employee_code="GONE",
        full_name="Old Timer",
        status=UserStatus.DISABLED,
    )
    ids = [str(work.users["viewer"]), str(gone)]
    response = await work.api("GET", "/directory/users", "member", params={"ids": ids})
    assert response.status_code == 200
    assert {e["employee_code"] for e in response.json()} == {"VIEWER", "GONE"}


async def test_lookup_by_id_does_not_cross_organizations(work: Work) -> None:
    foreign = str(work.other["user_id"])
    response = await work.api("GET", "/directory/users", "member", params={"ids": [foreign]})
    assert response.json() == []
    assert_problem(
        await work.api("GET", "/directory/users", "member", params={"ids": ["not-an-id"]}), 422
    )
