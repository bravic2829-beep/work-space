"""Records folded into groups with totals: counts, totals, labels, filters, rights and views."""

import json
from typing import Any

import pytest

from app.modules.records import groups
from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_sheets import make_sheet
from tests.work_world import Work


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    board = Board(work, await work.make_table(base_id, "Tasks", template="tasks"))
    score = await work.make_field(board.id, "Score", "number", config={"precision": 1})
    board.f["Score"] = score["id"]
    return board


async def fetch(
    board: Board,
    group_by: str,
    who: str = "admin",
    *,
    totals: list[str] | None = None,
    **params: Any,
) -> Any:
    query: dict[str, Any] = {"group_by": board.f.get(group_by, group_by), **params}
    if totals:
        query["aggregate"] = [
            f"{board.f.get(t.split(':')[0], t.split(':')[0])}:{t.split(':')[1]}" for t in totals
        ]
    return await board.work.api("GET", f"/tables/{board.id}/groups", who, params=query)


async def groups_of(board: Board, group_by: str, who: str = "admin", **kw: Any) -> dict[str, Any]:
    response = await fetch(board, group_by, who, **kw)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def by_label(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {g["label"]: g for g in body["groups"]}


async def rows_of(board: Board, group: dict[str, Any], who: str = "admin") -> list[str]:
    """The names of the records the group's own filter selects (the page's second request)."""
    response = await board.work.api(
        "GET",
        f"/tables/{board.id}/records",
        who,
        params={"filter": json.dumps(group["filter"])},
    )
    assert response.status_code == 200, response.text
    return sorted(r["data"][board.f["Name"]] for r in response.json()["items"])


# --- by a status or a choice ----------------------------------------------------------------------


async def test_groups_by_status_in_the_order_of_the_options(board: Board) -> None:
    s = board.status_options
    await board.create(Name="a", Status=s["Done"], Score=1.0)
    await board.create(Name="b", Status=s["To do"], Score=2.0)
    await board.create(Name="c", Status=s["To do"], Score=4.0)
    await board.create(Name="d", Status=s["Blocked"])
    await board.create(Name="e")  # no status chosen

    body = await groups_of(board, "Status", totals=["Score:sum", "Score:avg"])
    assert [g["label"] for g in body["groups"]] == ["To do", "Done", "Blocked", "(empty)"]
    assert body["total"] == 5 and body["truncated"] is False
    todo = by_label(body)["To do"]
    assert todo["count"] == 2
    assert [(t["fn"], t["value"]) for t in todo["totals"]] == [("sum", 6.0), ("avg", 3.0)]
    # A group with no value in the column has no total, not 0.
    assert [t["value"] for t in by_label(body)["Blocked"]["totals"]] == [None, None]
    assert by_label(body)["(empty)"]["key"] is None


async def test_every_group_carries_the_filter_that_selects_its_records(board: Board) -> None:
    s = board.status_options
    for name, status in [("a", "To do"), ("b", "To do"), ("c", "Done")]:
        await board.create(Name=name, Status=s[status])
    await board.create(Name="d")
    body = await groups_of(board, "Status")
    seen = {g["label"]: await rows_of(board, g) for g in body["groups"]}
    assert seen == {"To do": ["a", "b"], "Done": ["c"], "(empty)": ["d"]}
    for group in body["groups"]:
        assert len(await rows_of(board, group)) == group["count"]


async def test_the_filter_narrows_the_groups(board: Board) -> None:
    s = board.status_options
    await board.create(Name="a", Status=s["To do"], Score=1.0)
    await board.create(Name="b", Status=s["Done"], Score=9.0)
    narrowed = json.dumps([{"field": board.f["Score"], "op": "gt", "value": 5}])
    body = await groups_of(board, "Status", filter=narrowed)
    assert [(g["label"], g["count"]) for g in body["groups"]] == [("Done", 1)]
    assert body["total"] == 1


# --- by people and by links ---------------------------------------------------------------------


async def test_a_task_with_two_people_is_counted_for_each(board: Board) -> None:
    m, m2 = board.user("member"), board.user("member2")
    await board.create(Name="solo", Assignee=[m])
    await board.create(Name="pair", Assignee=[m, m2])
    await board.create(Name="nobody")

    body = await groups_of(board, "Assignee")
    assert body["total"] == 3  # tasks, not the sum of the groups
    counts = {g["key"]: g["count"] for g in body["groups"]}
    assert counts == {m: 2, m2: 1, None: 1}
    assert body["groups"][-1]["key"] is None  # no value comes last
    mine = next(g for g in body["groups"] if g["key"] == m)
    assert await rows_of(board, mine) == ["pair", "solo"]
    nobody = next(g for g in body["groups"] if g["key"] is None)
    assert await rows_of(board, nobody) == ["nobody"]
    # The group is named after the person, not their id.
    assert all(g["label"] != g["key"] for g in body["groups"] if g["key"])


async def test_groups_by_parent_task_are_named_after_the_parent(board: Board) -> None:
    objective = await board.create(Name="Launch the shop")
    other = await board.create(Name="Hire a designer")
    await board.create(Name="KR1", **{"Parent task": [objective["id"]]})
    await board.create(Name="KR2", **{"Parent task": [objective["id"]]})
    await board.create(Name="KR3", **{"Parent task": [other["id"]]})

    body = await groups_of(board, "Parent task")
    labels = by_label(body)
    assert labels["Launch the shop"]["count"] == 2
    assert labels["Hire a designer"]["count"] == 1
    # The objectives themselves have no parent.
    assert labels["(no link)"]["count"] == 2
    assert await rows_of(board, labels["Launch the shop"]) == ["KR1", "KR2"]
    assert await rows_of(board, labels["(no link)"]) == ["Hire a designer", "Launch the shop"]


# --- by a date -----------------------------------------------------------------------------------


async def test_groups_by_month_week_and_day(board: Board) -> None:
    due = "Due date"
    await board.create(Name="a", **{due: "2026-10-30"})
    await board.create(Name="b", **{due: "2026-11-02"})  # a Monday
    await board.create(Name="c", **{due: "2026-11-08"})  # the Sunday of that week
    await board.create(Name="d", **{due: "2026-11-09"})
    await board.create(Name="e")

    month = await groups_of(board, due)  # month is the default
    assert [(g["key"], g["label"], g["count"]) for g in month["groups"]] == [
        ("2026-10", "Oct 2026", 1),
        ("2026-11", "Nov 2026", 3),
        (None, "(no date)", 1),
    ]
    assert month["bucket"] == "month"
    assert await rows_of(board, month["groups"][1]) == ["b", "c", "d"]
    december_edge = await groups_of(board, due, bucket="month")
    assert december_edge["groups"][0]["filter"] == [
        {"field": board.f[due], "op": "gte", "value": "2026-10-01"},
        {"field": board.f[due], "op": "lt", "value": "2026-11-01"},
    ]

    week = await groups_of(board, due, bucket="week")
    labels = [(g["label"], g["count"]) for g in week["groups"]]
    assert labels == [
        ("Week of 2026-10-26", 1),
        ("Week of 2026-11-02", 2),
        ("Week of 2026-11-09", 1),
        ("(no date)", 1),
    ]
    assert await rows_of(board, week["groups"][1]) == ["b", "c"]

    day = await groups_of(board, due, bucket="day")
    assert [g["key"] for g in day["groups"]] == [
        "2026-10-30",
        "2026-11-02",
        "2026-11-08",
        "2026-11-09",
        None,
    ]
    assert await rows_of(board, day["groups"][2]) == ["c"]


async def test_a_month_that_ends_the_year_is_followed_by_january(board: Board) -> None:
    await board.create(Name="late", **{"Due date": "2026-12-31"})
    body = await groups_of(board, "Due date")
    assert body["groups"][0]["filter"][1] == {
        "field": board.f["Due date"],
        "op": "lt",
        "value": "2027-01-01",
    }
    assert await rows_of(board, body["groups"][0]) == ["late"]


async def test_groups_by_who_made_the_task_and_by_text(board: Board) -> None:
    await board.create("editor", Name="x")
    await board.create("editor", Name="y")
    await board.create("admin", Name="x")
    body = await groups_of(board, "Name")
    assert [(g["label"], g["count"]) for g in body["groups"]] == [("x", 2), ("y", 1)]
    assert await rows_of(board, body["groups"][0]) == ["x", "x"]


# --- totals ---------------------------------------------------------------------------------------


async def test_the_totals_sum_average_min_and_max(board: Board) -> None:
    for name, score in [("a", 1.5), ("b", 2.5), ("c", 8.0)]:
        await board.create(Name=name, Status=board.status_options["To do"], Score=score)
    body = await groups_of(
        board, "Status", totals=["Score:sum", "Score:avg", "Score:min", "Score:max"]
    )
    totals = {t["fn"]: t["value"] for t in body["groups"][0]["totals"]}
    assert totals == {"sum": 12.0, "avg": 4.0, "min": 1.5, "max": 8.0}


# --- who sees what ------------------------------------------------------------------------------


async def test_only_the_tasks_the_reader_may_open_are_counted(board: Board) -> None:
    await make_sheet(board, "member")
    await board.create(Name="mine", Assignee=[board.user("member")], Score=3.0)
    await board.create(Name="theirs", Assignee=[board.user("member2")], Score=7.0)

    admin = await groups_of(board, "Assignee", totals=["Score:sum"])
    assert admin["total"] == 2
    mine = await groups_of(board, "Assignee", "member", totals=["Score:sum"])
    assert mine["total"] == 1
    assert [g["key"] for g in mine["groups"]] == [board.user("member")]
    assert mine["groups"][0]["totals"][0]["value"] == 3.0


async def test_a_hidden_column_cannot_be_grouped_or_totalled(board: Board) -> None:
    await make_sheet(board, "member")
    await board.create(Name="mine", Assignee=[board.user("member")], Score=3.0)
    for column in ("Score", "Priority"):
        hidden = await board.work.api(
            "PUT",
            f"/fields/{board.f[column]}/access/{board.user('member')}",
            json={"access": "hidden"},
        )
        assert hidden.status_code == 200, hidden.text
    assert_problem(await fetch(board, "Priority", "member"), 422)
    assert_problem(await fetch(board, "Status", "member", totals=["Score:sum"]), 422)
    # The same requests are fine for somebody who may see the columns.
    assert (await fetch(board, "Priority")).status_code == 200
    assert (await fetch(board, "Status", totals=["Score:sum"])).status_code == 200
    # And the visible columns still work for the reader.
    assert (await fetch(board, "Status", "member")).status_code == 200


async def test_a_linked_record_the_reader_may_not_open_is_not_named(board: Board) -> None:
    await make_sheet(board, "member")
    secret = await board.create(Name="Secret objective", Assignee=[board.user("member2")])
    await board.create(
        Name="child", Assignee=[board.user("member")], **{"Parent task": [secret["id"]]}
    )
    seen = await groups_of(board, "Parent task", "member")
    # Nothing names the parent, and nothing carries its id: the task simply has no link for them.
    assert "Secret objective" not in json.dumps(seen)
    assert secret["id"] not in json.dumps(seen)
    assert [g["label"] for g in seen["groups"]] == ["(no link)"]


# --- what is refused ------------------------------------------------------------------------------


async def test_the_request_is_checked(board: Board) -> None:
    unknown = await fetch(board, "00000000-0000-0000-0000-000000000000")
    assert_problem(unknown, 422)
    assert_problem(await fetch(board, "Timer"), 422)  # a timer cannot be grouped
    assert_problem(await fetch(board, "Status", bucket="month"), 422)  # only a date has buckets
    assert_problem(await fetch(board, "Due date", bucket="year"), 422)
    assert_problem(await fetch(board, "Status", totals=["Name:sum"]), 422)  # not a number
    assert_problem(await fetch(board, "Status", totals=["Score:median"]), 422)
    assert_problem(await fetch(board, "Status", totals=["nope:sum"]), 422)
    assert_problem(await fetch(board, "Status", filter="not json"), 400)
    too_many = [f"{board.f['Score']}:sum"] * (groups.MAX_AGGREGATES + 1)
    response = await board.work.api(
        "GET",
        f"/tables/{board.id}/groups",
        params={"group_by": board.f["Status"], "aggregate": too_many},
    )
    assert_problem(response, 422)


async def test_a_big_set_of_groups_is_cut_and_says_so(
    board: Board, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(groups, "MAX_GROUPS", 2)
    for name in ("a", "b", "c"):
        await board.create(Name=name)
    body = await groups_of(board, "Name")
    assert [g["label"] for g in body["groups"]] == ["a", "b"]
    assert body["truncated"] is True and body["total"] == 3


async def test_nobody_outside_gets_groups(board: Board) -> None:
    assert_problem(await fetch(board, "Status", "member2"), 403)  # no way into the table
    assert_problem(await fetch(board, "Status", "other_admin"), 404)  # another company
    anonymous = await board.work.client.get(
        f"/api/v1/tables/{board.id}/groups", params={"group_by": board.f["Status"]}
    )
    assert anonymous.status_code == 401


# --- views that keep a grouping -----------------------------------------------------------------


async def save_view(board: Board, **config: Any) -> Any:
    return await board.work.api(
        "POST",
        f"/tables/{board.id}/views",
        "admin",
        json={"name": "Summary", "config": config},
    )


async def test_a_view_keeps_its_grouping_and_totals(board: Board) -> None:
    config = {
        "group_by": board.f["Parent task"],
        "totals": [{"field": board.f["Score"], "fn": "sum"}],
    }
    created = await save_view(board, **config)
    assert created.status_code == 201, created.text
    saved = created.json()["config"]
    assert saved["group_by"] == board.f["Parent task"]
    assert saved["totals"] == [{"field": board.f["Score"], "fn": "sum"}]
    assert "group_bucket" not in saved  # nothing is stored for what was not chosen
    # A view that does not group (like every view saved before groups existed) has no grouping.
    plain = await board.work.api(
        "POST",
        f"/tables/{board.id}/views",
        "admin",
        json={"name": "Plain", "config": {"filter": [], "sort": [], "hidden_fields": []}},
    )
    assert plain.status_code == 201, plain.text
    assert plain.json()["config"] == {"filter": [], "sort": [], "hidden_fields": []}
    listed = {
        v["name"]: v for v in (await board.work.api("GET", f"/tables/{board.id}/views")).json()
    }
    assert listed["Summary"]["config"]["group_by"] == board.f["Parent task"]


async def test_a_view_cannot_keep_a_grouping_the_list_would_refuse(board: Board) -> None:
    month = {"group_by": board.f["Due date"], "group_bucket": "week"}
    assert (await save_view(board, **month)).status_code == 201
    bad_cases: list[dict[str, Any]] = [
        {"group_by": board.f["Timer"]},
        {"group_by": "00000000-0000-0000-0000-000000000000"},
        {"group_by": board.f["Status"], "group_bucket": "month"},
        {"group_bucket": "month"},
        {"totals": [{"field": board.f["Score"], "fn": "sum"}]},
        {"group_by": board.f["Status"], "totals": [{"field": board.f["Name"], "fn": "sum"}]},
        {"group_by": board.f["Status"], "totals": [{"field": board.f["Score"], "fn": "median"}]},
    ]
    for index, config in enumerate(bad_cases):
        response = await board.work.api(
            "POST",
            f"/tables/{board.id}/views",
            "admin",
            json={"name": f"Bad {index}", "config": config},
        )
        assert response.status_code == 422, (config, response.text)
