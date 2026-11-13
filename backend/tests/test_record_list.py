import json
import uuid
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.work_world import Work


class Grid(Board):
    """A tasks table with extra columns and eight records."""

    options: dict[str, dict[str, str]]

    async def names(
        self,
        who: str = "admin",
        *,
        filters: list[dict[str, Any]] | None = None,
        sort: list[str] | None = None,
        limit: int = 100,
    ) -> list[str]:
        """The names of the records of a whole listing (all pages, in order)."""
        names: list[str] = []
        cursor: str | None = None
        while True:
            params: dict[str, Any] = {"limit": limit}
            if filters is not None:
                params["filter"] = json.dumps(filters)
            if sort:
                params["sort"] = sort
            if cursor:
                params["cursor"] = cursor
            response = await self.work.api("GET", f"/tables/{self.id}/records", who, params=params)
            assert response.status_code == 200, response.text
            body = response.json()
            names += [item["data"].get(self.f["Name"], "?") for item in body["items"]]
            cursor = body["next_cursor"]
            if cursor is None:
                return names

    def cond(self, column: str, op: str, value: Any = None) -> dict[str, Any]:
        return {"field": self.f[column], "op": op, "value": value}


@pytest.fixture
async def grid(work: Work) -> Grid:
    base_id = await work.make_base()
    table = await work.make_table(base_id, "Tasks", template="tasks")
    board = Grid(work, table)
    t = table["id"]
    points = await work.make_field(t, "Points", "number", config={"precision": 1})
    done = await work.make_field(t, "Done", "checkbox")
    priority = await work.make_field(
        t,
        "Priority",
        "single_select",
        config={"options": [{"name": "High"}, {"name": "Medium"}, {"name": "Low"}]},
    )
    tags = await work.make_field(
        t, "Tags", "multi_select", config={"options": [{"name": "x"}, {"name": "y"}]}
    )
    board.f.update(
        {"Points": points["id"], "Done": done["id"], "Priority": priority["id"], "Tags": tags["id"]}
    )
    pri = {o["name"]: o["id"] for o in priority["config"]["options"]}
    tag = {o["name"]: o["id"] for o in tags["config"]["options"]}
    m, m2 = board.user("member"), board.user("member2")

    rows: list[dict[str, Any]] = [
        {
            "Name": "Alpha",
            "Points": 10,
            "Done": True,
            "Priority": pri["High"],
            "Tags": [tag["x"]],
            "Due date": "2026-01-10",
            "Assignee": [m],
        },
        {
            "Name": "Beta",
            "Points": 5,
            "Done": False,
            "Priority": pri["Low"],
            "Tags": [tag["y"]],
            "Due date": "2026-02-10",
        },
        {
            "Name": "gamma 100%",
            "Points": 20,
            "Priority": pri["Medium"],
            "Tags": [tag["x"], tag["y"]],
            "Due date": "2026-03-10",
            "Assignee": [m2],
        },
        {"Name": "Delta", "Done": True},
        {
            "Name": "alpha two",
            "Points": 5,
            "Priority": pri["High"],
            "Due date": "2026-01-10",
            "Follower": [m],
        },
        {"Name": "Epsilon", "Points": 7.5, "Done": False},
        {"Name": "Zeta", "Points": 10, "Done": False, "Priority": pri["Medium"]},
        {"Name": "Eta", "Tags": [tag["y"]], "Due date": "2026-04-01"},
    ]
    for row in rows:
        await board.create(**row)
    board.options = {"Priority": pri, "Tags": tag}
    return board


# --- who sees what ---------------------------------------------------------------------------


async def test_members_and_admins_list_every_record_in_creation_order(grid: Grid) -> None:
    expected = ["Alpha", "Beta", "gamma 100%", "Delta", "alpha two", "Epsilon", "Zeta", "Eta"]
    for who in ("admin", "wsadmin", "editor", "commenter", "viewer"):
        assert await grid.names(who) == expected


async def test_a_stranger_sees_only_their_own_records(grid: Grid) -> None:
    assert await grid.names("member") == ["Alpha", "alpha two"]  # assignee and follower
    assert await grid.names("member2") == ["gamma 100%"]


async def test_someone_with_nothing_to_see_cannot_open_the_list(grid: Grid, work: Work) -> None:
    other = await work.make_table(await work.make_base("Second"), "Empty")
    response = await work.api("GET", f"/tables/{other['id']}/records", "member")
    assert_problem(response, 403)
    response = await work.api("GET", f"/tables/{grid.id}/records", "other_admin")
    assert_problem(response, 404)
    assert_problem(await work.api("GET", f"/tables/{grid.id}/records", "nobody"), 401)
    assert_problem(await work.api("GET", f"/tables/{uuid.uuid4()}/records"), 404)


async def test_the_list_has_no_records_in_the_trash(grid: Grid) -> None:
    created = await grid.create(Name="Temporary")
    assert "Temporary" in await grid.names()
    await grid.work.api("DELETE", f"/records/{created['id']}")
    assert "Temporary" not in await grid.names()


async def test_hidden_columns_are_missing_from_the_list(grid: Grid) -> None:
    work = grid.work
    await work.api(
        "PUT",
        f"/fields/{grid.f['Points']}/access/{grid.user('viewer')}",
        json={"access": "hidden"},
    )
    seen = (await work.api("GET", f"/tables/{grid.id}/records", "viewer")).json()["items"]
    assert seen
    assert all(grid.f["Points"] not in item["data"] for item in seen)
    assert all(grid.f["Name"] in item["data"] for item in seen)
    full = (await work.api("GET", f"/tables/{grid.id}/records", "editor")).json()["items"]
    assert any(grid.f["Points"] in item["data"] for item in full)


async def test_hidden_columns_cannot_be_used_to_filter_or_sort(grid: Grid) -> None:
    """Otherwise the order or the matches would leak the values of a column you cannot see."""
    work = grid.work
    await work.api(
        "PUT",
        f"/fields/{grid.f['Points']}/access/{grid.user('viewer')}",
        json={"access": "hidden"},
    )
    url = f"/tables/{grid.id}/records"
    flt = json.dumps([grid.cond("Points", "gt", 6)])
    assert_problem(await work.api("GET", url, "viewer", params={"filter": flt}), 422)
    assert_problem(
        await work.api("GET", url, "viewer", params={"sort": f"{grid.f['Points']}:asc"}), 422
    )
    assert (await work.api("GET", url, "editor", params={"filter": flt})).status_code == 200


# --- pagination ------------------------------------------------------------------------------


async def test_pages_follow_each_other_without_gaps_or_repeats(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"
    first = (await grid.work.api("GET", url, params={"limit": 3})).json()
    assert len(first["items"]) == 3
    assert first["next_cursor"]
    second = (
        await grid.work.api("GET", url, params={"limit": 3, "cursor": first["next_cursor"]})
    ).json()
    third = (
        await grid.work.api("GET", url, params={"limit": 3, "cursor": second["next_cursor"]})
    ).json()
    ids = [i["id"] for page in (first, second, third) for i in page["items"]]
    assert len(ids) == len(set(ids)) == 8
    assert third["next_cursor"] is None
    assert len(third["items"]) == 2


async def test_an_exact_page_size_has_no_empty_extra_page(grid: Grid) -> None:
    page = (await grid.work.api("GET", f"/tables/{grid.id}/records", params={"limit": 8})).json()
    assert len(page["items"]) == 8
    assert page["next_cursor"] is None


async def test_pagination_input_is_validated(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"
    for params in (
        {"limit": 0},
        {"limit": 101},
        {"limit": -1},
        {"limit": "many"},
        {"cursor": "garbage"},
        {"cursor": "e30="},
    ):
        assert_problem(await grid.work.api("GET", url, params=params), 422)


async def test_a_cursor_only_works_for_the_same_sort(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"
    page = (await grid.work.api("GET", url, params={"limit": 2})).json()
    other = {"limit": 2, "cursor": page["next_cursor"], "sort": f"{grid.f['Points']}:asc"}
    assert_problem(await grid.work.api("GET", url, params=other), 422)


SORTS = [
    ["Points:asc"],
    ["Points:desc"],
    ["Name:asc"],
    ["Name:desc"],
    ["Due date:asc"],
    ["Due date:desc"],
    ["Done:asc"],
    ["Done:desc", "Points:asc"],
    ["Priority:asc"],
    ["Priority:desc", "Name:asc"],
    ["Points:asc", "Due date:desc", "Name:asc"],
]


@pytest.mark.parametrize("spec", SORTS, ids=lambda spec: "+".join(spec))
async def test_paging_through_any_sort_gives_the_same_order_as_one_page(
    grid: Grid, spec: list[str]
) -> None:
    sort = [f"{grid.f[part.split(':')[0]]}:{part.split(':')[1]}" for part in spec]
    in_one_page = await grid.names(sort=sort, limit=100)
    assert len(in_one_page) == 8
    for size in (1, 2, 3, 5):
        assert await grid.names(sort=sort, limit=size) == in_one_page, size


async def test_numbers_sort_as_numbers_with_empty_cells_last(grid: Grid) -> None:
    asc = await grid.names(sort=[f"{grid.f['Points']}:asc"])
    # 5, 5, 7.5, 10, 10, 20 and then the three without points, each group in creation order.
    assert asc == ["Beta", "alpha two", "Epsilon", "Alpha", "Zeta", "gamma 100%", "Delta", "Eta"]
    desc = await grid.names(sort=[f"{grid.f['Points']}:desc"])
    assert desc == ["gamma 100%", "Alpha", "Zeta", "Epsilon", "Beta", "alpha two", "Delta", "Eta"]


async def test_select_columns_sort_by_the_order_of_their_options(grid: Grid) -> None:
    asc = await grid.names(sort=[f"{grid.f['Priority']}:asc"])
    assert asc[:5] == ["Alpha", "alpha two", "gamma 100%", "Zeta", "Beta"]  # High, Medium, Low
    assert set(asc[5:]) == {"Delta", "Epsilon", "Eta"}


async def test_dates_checkboxes_and_text_sort(grid: Grid) -> None:
    dates = await grid.names(sort=[f"{grid.f['Due date']}:asc"])
    assert dates[:5] == ["Alpha", "alpha two", "Beta", "gamma 100%", "Eta"]
    checks = await grid.names(sort=[f"{grid.f['Done']}:desc"])
    assert checks[:2] == ["Alpha", "Delta"]
    names = await grid.names(sort=[f"{grid.f['Name']}:asc"])
    assert names == sorted(names)


async def test_invalid_sorts_are_rejected(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"
    bad = [
        f"{grid.f['Points']}:sideways",
        "nonsense:asc",
        str(uuid.uuid4()),
        f"{grid.f['Tags']}:asc",  # a multi select has no order
        f"{grid.f['Assignee']}:asc",
        f"{grid.f['Parent task']}:asc",
    ]
    for item in bad:
        assert_problem(await grid.work.api("GET", url, params={"sort": item}), 422)
    twice = [f"{grid.f['Points']}:asc", f"{grid.f['Points']}:desc"]
    assert_problem(await grid.work.api("GET", url, params={"sort": twice}), 422)
    many = [f"{grid.f[n]}:asc" for n in ("Points", "Name", "Done", "Priority")]
    assert_problem(await grid.work.api("GET", url, params={"sort": many}), 422)


# --- filters ---------------------------------------------------------------------------------


async def test_text_filters(grid: Grid) -> None:
    assert await grid.names(filters=[grid.cond("Name", "eq", "Beta")]) == ["Beta"]
    assert await grid.names(filters=[grid.cond("Name", "eq", "beta")]) == []
    contains = await grid.names(filters=[grid.cond("Name", "contains", "ALPHA")])
    assert contains == ["Alpha", "alpha two"]  # ignores capitals
    neq = await grid.names(filters=[grid.cond("Name", "neq", "Beta")])
    assert len(neq) == 7
    assert await grid.names(filters=[grid.cond("Name", "is_empty")]) == []
    assert len(await grid.names(filters=[grid.cond("Name", "is_not_empty")])) == 8


async def test_percent_and_underscore_are_ordinary_characters(grid: Grid) -> None:
    assert await grid.names(filters=[grid.cond("Name", "contains", "100%")]) == ["gamma 100%"]
    assert await grid.names(filters=[grid.cond("Name", "contains", "%")]) == ["gamma 100%"]
    assert await grid.names(filters=[grid.cond("Name", "contains", "_")]) == []


async def test_number_filters(grid: Grid) -> None:
    assert await grid.names(filters=[grid.cond("Points", "eq", 10)]) == ["Alpha", "Zeta"]
    assert await grid.names(filters=[grid.cond("Points", "gt", 7.5)]) == [
        "Alpha",
        "gamma 100%",
        "Zeta",
    ]
    assert await grid.names(filters=[grid.cond("Points", "gte", 7.5)]) == [
        "Alpha",
        "gamma 100%",
        "Epsilon",
        "Zeta",
    ]
    assert await grid.names(filters=[grid.cond("Points", "lt", 6)]) == ["Beta", "alpha two"]
    assert await grid.names(filters=[grid.cond("Points", "lte", 5)]) == ["Beta", "alpha two"]
    assert await grid.names(filters=[grid.cond("Points", "eq", "10")]) == ["Alpha", "Zeta"]
    assert await grid.names(filters=[grid.cond("Points", "is_empty")]) == ["Delta", "Eta"]
    # A missing number is not "not equal" to a number... it is simply not a match for gt/lt.
    assert "Delta" in await grid.names(filters=[grid.cond("Points", "neq", 10)])


async def test_date_filters(grid: Grid) -> None:
    assert await grid.names(filters=[grid.cond("Due date", "eq", "2026-01-10")]) == [
        "Alpha",
        "alpha two",
    ]
    between = [
        grid.cond("Due date", "gte", "2026-02-01"),
        grid.cond("Due date", "lt", "2026-04-01"),
    ]
    assert await grid.names(filters=between) == ["Beta", "gamma 100%"]
    assert await grid.names(filters=[grid.cond("Due date", "is_empty")]) == [
        "Delta",
        "Epsilon",
        "Zeta",
    ]


async def test_checkbox_filters_treat_empty_as_unchecked(grid: Grid) -> None:
    assert await grid.names(filters=[grid.cond("Done", "eq", True)]) == ["Alpha", "Delta"]
    unchecked = await grid.names(filters=[grid.cond("Done", "eq", False)])
    assert unchecked == ["Beta", "gamma 100%", "alpha two", "Epsilon", "Zeta", "Eta"]


async def test_select_filters(grid: Grid) -> None:
    high, low = grid.options["Priority"]["High"], grid.options["Priority"]["Low"]
    assert await grid.names(filters=[grid.cond("Priority", "eq", high)]) == ["Alpha", "alpha two"]
    either = await grid.names(filters=[grid.cond("Priority", "in", [high, low])])
    assert either == ["Alpha", "Beta", "alpha two"]
    assert len(await grid.names(filters=[grid.cond("Priority", "neq", high)])) == 6
    assert await grid.names(filters=[grid.cond("Priority", "is_empty")]) == [
        "Delta",
        "Epsilon",
        "Eta",
    ]


async def test_multi_select_and_user_filters(grid: Grid) -> None:
    x, y = grid.options["Tags"]["x"], grid.options["Tags"]["y"]
    assert await grid.names(filters=[grid.cond("Tags", "contains", x)]) == ["Alpha", "gamma 100%"]
    assert await grid.names(filters=[grid.cond("Tags", "contains", y)]) == [
        "Beta",
        "gamma 100%",
        "Eta",
    ]
    both = [grid.cond("Tags", "contains", x), grid.cond("Tags", "contains", y)]
    assert await grid.names(filters=both) == ["gamma 100%"]
    mine = [grid.cond("Assignee", "contains", grid.user("member"))]
    assert await grid.names(filters=mine) == ["Alpha"]
    assert len(await grid.names(filters=[grid.cond("Assignee", "is_empty")])) == 6
    assert len(await grid.names(filters=[grid.cond("Tags", "is_not_empty")])) == 4


async def test_created_by_and_created_time_filters(grid: Grid) -> None:
    await grid.create("editor", Name="By editor")
    by = await grid.work.make_field(grid.id, "Author", "created_by")
    when = await grid.work.make_field(grid.id, "Created", "created_time")
    grid.f["Author"], grid.f["Created"] = by["id"], when["id"]
    assert await grid.names(filters=[grid.cond("Author", "eq", grid.user("editor"))]) == [
        "By editor"
    ]
    assert len(await grid.names(filters=[grid.cond("Author", "neq", grid.user("editor"))])) == 8
    assert len(await grid.names(filters=[grid.cond("Created", "gt", "2020-01-01T00:00:00Z")])) == 9
    assert await grid.names(filters=[grid.cond("Created", "lt", "2020-01-01T00:00:00Z")]) == []


async def test_conditions_are_combined_with_and(grid: Grid) -> None:
    found = await grid.names(
        filters=[grid.cond("Points", "gte", 10), grid.cond("Done", "eq", False)]
    )
    # "gamma 100%" has 20 points and an empty (so unchecked) box.
    assert found == ["gamma 100%", "Zeta"]


async def test_filter_and_sort_work_together_across_pages(grid: Grid) -> None:
    sort = [f"{grid.f['Points']}:desc"]
    flt = [grid.cond("Points", "gte", 5)]
    one = await grid.names(filters=flt, sort=sort)
    assert one == ["gamma 100%", "Alpha", "Zeta", "Epsilon", "Beta", "alpha two"]
    assert await grid.names(filters=flt, sort=sort, limit=2) == one


async def test_a_filter_can_never_show_records_you_may_not_see(grid: Grid) -> None:
    """member is only the assignee of "Alpha", whatever the filter matches."""
    assert await grid.names("member", filters=[grid.cond("Points", "gte", 0)]) == [
        "Alpha",
        "alpha two",
    ]
    assert await grid.names("member", filters=[grid.cond("Name", "contains", "gamma")]) == []
    assert await grid.names("member2", filters=[grid.cond("Name", "contains", "Alpha")]) == []


async def test_invalid_filters_are_rejected(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"

    async def get(raw: str) -> Any:
        return await grid.work.api("GET", url, params={"filter": raw})

    assert_problem(await get("not json"), 400)
    assert_problem(await get('{"field": "x"}'), 400)
    assert_problem(await get("[1, 2]"), 400)
    unknown_op = [grid.cond("Name", "regex", ".*")]
    assert_problem(await get(json.dumps(unknown_op)), 422)
    assert_problem(await get(json.dumps([grid.cond("Name", "gt", "a")])), 422)  # no order for text
    assert_problem(await get(json.dumps([grid.cond("Points", "contains", "1")])), 422)
    assert_problem(await get(json.dumps([grid.cond("Points", "gt", "lots")])), 422)
    assert_problem(await get(json.dumps([grid.cond("Done", "eq", "yes")])), 422)
    assert_problem(await get(json.dumps([grid.cond("Priority", "eq", "not-an-option")])), 422)
    assert_problem(await get(json.dumps([grid.cond("Priority", "in", [])])), 422)
    assert_problem(await get(json.dumps([grid.cond("Due date", "eq", "10 Jan")])), 422)
    assert_problem(await get(json.dumps([grid.cond("Assignee", "contains", "nobody")])), 422)
    assert_problem(
        await get(json.dumps([{"field": str(uuid.uuid4()), "op": "eq", "value": 1}])), 422
    )
    extra = [{"field": grid.f["Name"], "op": "eq", "value": "a", "sql": "1=1"}]
    assert_problem(await get(json.dumps(extra)), 422)
    too_many = [grid.cond("Name", "is_not_empty")] * 21
    assert_problem(await get(json.dumps(too_many)), 422)


async def test_sql_in_a_filter_is_just_text(grid: Grid) -> None:
    attacks = ["'; DROP TABLE records; --", "' OR '1'='1", "\\", '"', "%' OR 1=1 --"]
    for attack in attacks:
        assert await grid.names(filters=[grid.cond("Name", "eq", attack)]) == []
        assert await grid.names(filters=[grid.cond("Name", "contains", attack)]) == []
    assert len(await grid.names()) == 8  # nothing was dropped
    # A field id that is not an id of this table never reaches the database.
    bad = json.dumps([{"field": "' OR '1'='1", "op": "eq", "value": "a"}])
    response = await grid.work.api("GET", f"/tables/{grid.id}/records", params={"filter": bad})
    assert_problem(response, 422)
    response = await grid.work.api(
        "GET", f"/tables/{grid.id}/records", params={"sort": "'; DROP TABLE records; --:asc"}
    )
    assert_problem(response, 422)


# --- values the client controls must never cause a 500 ---------------------------------------


def forged_cursor(signature: str, values: list[Any]) -> str:
    from app.modules.records.listing import make_cursor

    return make_cursor(signature, values)


async def test_a_forged_cursor_is_refused_or_harmless_never_a_server_error(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"
    signature = "created_at:asc|id:asc"
    forged: list[list[Any]] = [
        ["2026-01-01T00:00:00+00:00", "not-a-uuid"],
        ["not-a-date", str(uuid.uuid4())],
        ["2026-01-01T00:00:00", str(uuid.uuid4())],  # no timezone
        [None, str(uuid.uuid4())],
        [["list"], {"dict": 1}],
        [12345, 67890],
        ["2026-01-01T00:00:00+00:00"],  # too short
        ["2026-01-01T00:00:00+00:00", str(uuid.uuid4()), "extra"],
        [True, False],
    ]
    for values in forged:
        cursor = forged_cursor(signature, values)
        response = await grid.work.api("GET", url, params={"cursor": cursor})
        assert response.status_code in (200, 422), (values, response.status_code, response.text)


async def test_a_forged_cursor_for_a_sorted_list_is_not_a_server_error(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"
    cases: list[tuple[str, str, list[Any]]] = [
        (
            f"{grid.f['Points']}:asc",
            "num",
            ["not-a-number", "2026-01-01T00:00:00+00:00", str(uuid.uuid4())],
        ),
        (
            f"{grid.f['Done']}:asc",
            "bool",
            ["maybe", "2026-01-01T00:00:00+00:00", str(uuid.uuid4())],
        ),
        (
            f"{grid.f['Name']}:asc",
            "text",
            [{"a": 1}, "2026-01-01T00:00:00+00:00", str(uuid.uuid4())],
        ),
    ]
    for sort, _, values in cases:
        signature = f"{sort}|created_at:asc|id:asc"
        response = await grid.work.api(
            "GET", url, params={"sort": sort, "cursor": forged_cursor(signature, values)}
        )
        assert response.status_code in (200, 422), (sort, response.status_code, response.text)


async def test_odd_filter_values_are_refused_or_harmless_never_a_server_error(grid: Grid) -> None:
    url = f"/tables/{grid.id}/records"
    odd: list[dict[str, Any]] = [
        grid.cond("Points", "gt", "1e400"),
        grid.cond("Points", "gt", "Infinity"),
        grid.cond("Points", "eq", {"nested": 1}),
        grid.cond("Points", "eq", [1, 2]),
        grid.cond("Points", "gt", 10**30),
        grid.cond("Name", "eq", {"a": 1}),
        grid.cond("Name", "contains", None),
        grid.cond("Name", "eq", 5),
        grid.cond("Name", "contains", "\x00"),
        grid.cond("Due date", "eq", "2026-13-45"),
        grid.cond("Due date", "gt", ["2026-01-01"]),
        grid.cond("Due date", "eq", None),
        grid.cond("Done", "eq", None),
        grid.cond("Priority", "in", ["not-an-option"]),
        grid.cond("Priority", "in", "high"),
        grid.cond("Tags", "contains", ["o"]),
    ]
    for condition in odd:
        response = await grid.work.api("GET", url, params={"filter": json.dumps([condition])})
        assert response.status_code in (200, 422), (condition, response.status_code, response.text)


async def test_created_time_filters_accept_dates_without_a_timezone(grid: Grid) -> None:
    created = await grid.work.make_field(grid.id, "Created", "created_time")
    grid.f["Created"] = created["id"]
    for value in ("2020-01-01", "2020-01-01T00:00:00", "2020-01-01T00:00:00Z"):
        response = await grid.work.api(
            "GET",
            f"/tables/{grid.id}/records",
            params={"filter": json.dumps([grid.cond("Created", "gt", value)])},
        )
        assert response.status_code == 200, (value, response.status_code, response.text)
        assert len(response.json()["items"]) == 8
    response = await grid.work.api(
        "GET",
        f"/tables/{grid.id}/records",
        params={"filter": json.dumps([grid.cond("Created", "gt", "yesterday")])},
    )
    assert_problem(response, 422)
