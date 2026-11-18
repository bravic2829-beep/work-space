"""The Overview of Reports: the ten numbers, the trend, the filters and what a reader may see."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_okr import add_kr, check_in, objective
from tests.test_records import Board
from tests.test_review import review
from tests.test_sheets import make_sheet
from tests.work_world import Work


def day(offset: int = 0) -> str:
    return (datetime.now(UTC).date() + timedelta(days=offset)).isoformat()


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def dash(work: Work, who: str = "admin", **params: Any) -> dict[str, Any]:
    response = await work.api("GET", "/reports/dashboard", who, params={"date": day(), **params})
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def finish(board: Board, task: dict[str, Any], who: str = "member") -> None:
    """The assignee reports it done and the creator approves: a done task with a history."""
    task = (await review(board.work, task, who, "submit")).json()
    assert (await review(board.work, task, "admin", "approve")).status_code == 200


async def test_the_ten_numbers(board: Board) -> None:
    s, m = board.status_options, board.user("member")
    await board.create(Name="Late", Assignee=[m], **{"Due date": day(-3)})
    await board.create(Name="Soon", Assignee=[m], **{"Due date": day(1)})
    await board.create(Name="Stuck", Assignee=[m], Status=s["Blocked"], **{"Due date": day(10)})
    await board.create(Name="Going", Assignee=[m], Status=s["In progress"], **{"Due date": day(0)})
    early = await board.create(Name="Early", Assignee=[m], **{"Due date": day(2)})
    behind = await board.create(Name="Behind", Assignee=[m], **{"Due date": day(-1)})
    await finish(board, early)
    await finish(board, behind)
    # Due in a month: not in the period of the cards.
    await board.create(Name="Later", Assignee=[m], **{"Due date": day(30)})

    cards = (await dash(board.work))["cards"]
    # Six are in the default period (the last eight weeks and the next two); Later is not.
    assert cards["total"] == 6
    assert cards["completed"] == 2
    assert cards["overdue"] == 1
    # At risk: Soon (due in a day), Going (due today) and Stuck (blocked).
    assert cards["at_risk"] == 3
    assert cards["blocked"] == 1
    # Late, Soon and Going are still to be done (Stuck is blocked, the others are done).
    assert cards["in_progress"] == 3
    # One finished before its due date (Early), one after (Behind).
    assert cards["on_time_rate"] == 0.5
    assert cards["quality_score"] is None


async def test_a_blocked_task_is_at_risk_and_counted_as_blocked(board: Board) -> None:
    s, m = board.status_options, board.user("member")
    await board.create(Name="Stuck", Assignee=[m], Status=s["Blocked"], **{"Due date": day(0)})
    cards = (await dash(board.work, to=day(5)))["cards"]
    assert (cards["blocked"], cards["at_risk"], cards["overdue"]) == (1, 1, 0)


async def test_no_finished_task_with_a_due_date_means_no_rate(board: Board) -> None:
    await board.create(Name="Plain", Assignee=[board.user("member")])
    assert (await dash(board.work))["cards"]["on_time_rate"] is None


async def test_the_trend_counts_each_week(board: Board) -> None:
    m = board.user("member")
    task = await board.create(Name="One", Assignee=[m], **{"Due date": day(1)})
    await finish(board, task)
    trend = (await dash(board.work))["trend"]
    assert 8 <= len(trend) <= 9
    assert sum(p["created"] for p in trend) == 1
    assert sum(p["completed"] for p in trend) == 1
    assert [p["week"] for p in trend] == sorted(p["week"] for p in trend)


async def test_filters_by_person_status_and_table(board: Board) -> None:
    work = board.work
    s, m, m2 = board.status_options, board.user("member"), board.user("member2")
    await board.create(Name="A", Assignee=[m], **{"Due date": day(-2)})
    await board.create(Name="B", Assignee=[m2], Status=s["Blocked"], **{"Due date": day(-2)})
    other = Board(
        work, await work.make_table(await work.make_base("Other"), "Other", template="tasks")
    )
    await other.create(Name="C", Assignee=[m], **{"Due date": day(-2)})

    assert (await dash(work))["cards"]["total"] == 3
    assert (await dash(work, person=m))["cards"]["total"] == 2
    assert (await dash(work, person=m2))["cards"]["total"] == 1
    assert (await dash(work, status="blocked"))["cards"]["total"] == 1
    scoped = await dash(work, table_id=board.id)
    assert scoped["cards"]["total"] == 2 and scoped["table_ids"] == [board.id]
    assert {p["name"]: p["total"] for p in (await dash(work))["projects"]} == {
        "Tasks": 2,
        "Other": 1,
    }
    assert_problem(await work.api("GET", "/reports/dashboard", params={"status": "nonsense"}), 422)
    assert_problem(
        await work.api("GET", "/reports/dashboard", params={"from": day(0), "to": day(-1)}),
        422,
    )


async def test_the_period_limits_the_cards(board: Board) -> None:
    m = board.user("member")
    await board.create(Name="Old", Assignee=[m], **{"Due date": day(-20)})
    await board.create(Name="New", Assignee=[m], **{"Due date": day(-2)})
    assert (await dash(board.work, **{"from": day(-5), "to": day(0)}))["cards"]["total"] == 1
    assert (await dash(board.work, **{"from": day(-30), "to": day(0)}))["cards"]["total"] == 2


async def test_a_reader_only_gets_numbers_over_their_own_tasks(board: Board) -> None:
    await make_sheet(board, "member")
    await board.create(Name="Mine", Assignee=[board.user("member")], **{"Due date": day(-2)})
    await board.create(Name="Not mine", Assignee=[board.user("member2")], **{"Due date": day(-2)})
    assert (await dash(board.work, "admin"))["cards"]["total"] == 2
    seen = await dash(board.work, "member")
    assert seen["cards"]["total"] == 1
    assert [p["user_id"] for p in seen["people"]] == [board.user("member")]
    # Another company counts nothing of it.
    other = await dash(board.work, "other_admin")
    assert other["cards"]["total"] == 0 and other["table_ids"] == []
    assert_problem(
        await board.work.api(
            "GET", "/reports/dashboard", "other_admin", params={"table_id": board.id}
        ),
        404,
    )


async def test_a_hidden_column_gives_no_number_and_no_filter(board: Board) -> None:
    work = board.work
    await board.create(Name="Late", Assignee=[board.user("member")], **{"Due date": day(-2)})
    for column in ("Due date", "Assignee"):
        await work.api(
            "PUT",
            f"/fields/{board.f[column]}/access/{board.user('viewer')}",
            json={"access": "hidden"},
        )
    seen = await dash(work, "viewer")
    assert seen["cards"]["overdue"] is None and seen["cards"]["at_risk"] is None
    assert seen["cards"]["on_time_rate"] is None
    # Asking by person cannot be used to find out who has what: nothing matches.
    assert (await dash(work, "viewer", person=board.user("member")))["cards"]["total"] == 0


async def test_the_okr_of_the_current_cycle_is_part_of_the_overview(
    work: Work, board: Board
) -> None:
    assert (await dash(work))["okr"] is None
    created = await work.api(
        "POST",
        "/okr/cycles",
        json={"name": "Now", "starts_on": day(-30), "ends_on": day(60)},
    )
    cycle = created.json()
    obj = await objective(work, cycle, "member")
    with_kr = await add_kr(work, obj, start_value=0, target_value=10)
    kr = with_kr["key_results"][0]
    assert (await check_in(work, kr["id"], 5)).status_code == 201
    snapshot = (await dash(work))["okr"]
    assert snapshot["cycle_name"] == "Now"
    assert (snapshot["objectives"], snapshot["key_results"], snapshot["progress"]) == (1, 1, 0.5)
