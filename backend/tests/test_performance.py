"""Performance: criteria and weights, the measures worked out from tasks, manual scores and who sees
whom."""

from typing import Any

import pytest

from tests.api_helpers import assert_problem
from tests.test_dashboard import day, finish
from tests.test_okr import set_manager
from tests.test_records import Board
from tests.test_review import review
from tests.work_world import Work

PERIOD = day(0)[:7]


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def criteria(work: Work, who: str = "admin") -> dict[str, Any]:
    response = await work.api("GET", "/performance/criteria", who)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def by_name(work: Work, name: str) -> dict[str, Any]:
    return next(c for c in (await criteria(work))["criteria"] if c["name"] == name)


async def scores(work: Work, who: str = "admin", **params: Any) -> dict[str, Any]:
    response = await work.api(
        "GET",
        "/performance/scores",
        who,
        params={"period": PERIOD, "date": day(1), **params},
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def row(body: dict[str, Any], work: Work, who: str) -> dict[str, Any]:
    return next(p for p in body["people"] if p["user_id"] == str(work.users[who]))


def by_id(person: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {s["criterion_id"]: s for s in person["scores"]}


async def give(
    work: Work, who: str, criterion: str, target: str, score: int, reason: str = "Good job"
) -> Any:
    return await work.api(
        "PUT",
        "/performance/scores",
        who,
        json={
            "criterion_id": criterion,
            "user_id": str(work.users[target]),
            "period": PERIOD,
            "score": score,
            "reason": reason,
        },
    )


# --- the criteria --------------------------------------------------------------------------------


async def test_an_organization_starts_with_the_six_criteria(work: Work) -> None:
    body = await criteria(work, "member")
    assert [(c["name"], c["weight"]) for c in body["criteria"]] == [
        ("Task completion", 25),
        ("On-time delivery", 20),
        ("Work quality", 20),
        ("Initiative and responsibility", 15),
        ("Collaboration and handover", 10),
        ("Improvement and growth", 10),
    ]
    assert body["total_weight"] == 100
    assert [c["metric"] for c in body["criteria"]][:3] == [
        "completion_rate",
        "on_time_rate",
        "rework_rate",
    ]
    assert (body["can_manage"], (await criteria(work))["can_manage"]) == (False, True)
    assert {m["id"] for m in body["metrics"]} >= {"completion_rate", "update_compliance"}
    # Asking again does not make them twice.
    assert len((await criteria(work))["criteria"]) == 6
    # Another company has its own.
    assert len((await criteria(work, "other_admin"))["criteria"]) == 6


async def test_only_an_admin_changes_the_criteria(work: Work) -> None:
    first = (await criteria(work))["criteria"][0]
    for who in ("member", "wsadmin"):
        body = {"name": "X", "weight": 5}
        assert_problem(await work.api("POST", "/performance/criteria", who, json=body), 403)
        url = f"/performance/criteria/{first['id']}"
        assert_problem(await work.api("PATCH", url, who, json={"weight": 5}), 403)
        assert_problem(await work.api("GET", f"{url}/history", who), 403)


async def test_a_criterion_can_be_added_reweighed_and_switched_off(work: Work) -> None:
    created = await work.api(
        "POST",
        "/performance/criteria",
        json={"name": "Customer feedback", "weight": 10, "description": "Reviews from customers"},
    )
    assert created.status_code == 201, created.text
    new = created.json()
    assert (new["metric"], new["is_active"], new["position"]) == (None, True, 6)
    assert (await criteria(work))["total_weight"] == 110

    url = f"/performance/criteria/{new['id']}"
    changed = await work.api(
        "PATCH", url, json={"weight": 15, "is_active": False, "reason": "Not used this year"}
    )
    assert changed.status_code == 200 and changed.json()["weight"] == 15
    # A criterion that is off does not count towards the total.
    assert (await criteria(work))["total_weight"] == 100

    history = (await work.api("GET", f"{url}/history")).json()
    assert [h["reason"] for h in history] == ["Not used this year", None]
    assert history[0]["changes"]["weight"] == {"from": 10, "to": 15}
    assert history[0]["changes"]["is_active"] == {"from": True, "to": False}
    assert "created" in history[1]["changes"]
    # Nothing changed, nothing kept.
    await work.api("PATCH", url, json={"weight": 15})
    assert len((await work.api("GET", f"{url}/history")).json()) == 2


async def test_the_names_and_weights_are_checked(work: Work) -> None:
    other = "Task completion"
    assert_problem(
        await work.api("POST", "/performance/criteria", json={"name": other.lower(), "weight": 5}),
        409,
    )
    assert_problem(
        await work.api("POST", "/performance/criteria", json={"name": "A", "weight": 101}), 422
    )
    assert_problem(
        await work.api("POST", "/performance/criteria", json={"name": "A", "weight": -1}), 422
    )
    first = (await criteria(work))["criteria"][0]
    url = f"/performance/criteria/{first['id']}"
    assert_problem(await work.api("PATCH", url, json={"name": "On-time delivery"}), 409)
    assert_problem(await work.api("PATCH", url, json={"weight": None}), 422)
    # Another company's criterion does not exist for this one.
    assert_problem(await work.api("PATCH", url, "other_admin", json={"weight": 1}), 404)


# --- the measures --------------------------------------------------------------------------------


async def make_month(board: Board) -> None:
    """Three tasks of the month for "member": one done and sent for review once, one sent back, one
    left open (late, as the report is read the next day)."""
    m = board.user("member")
    due = {"Due date": day(0)}
    done = await board.create(Name="Done", Assignee=[m], **due)
    await finish(board, done)
    back = await board.create(Name="Back", Assignee=[m], **due)
    sent = (await review(board.work, back, "member", "submit")).json()
    assert (await review(board.work, sent, "admin", "reject")).status_code == 200
    await board.create(Name="Open", Assignee=[m], **due)


async def test_the_measures_come_from_the_tasks_and_are_weighted(board: Board) -> None:
    work = board.work
    await make_month(board)
    body = await scores(work)
    member = row(body, work, "member")
    named = {c["name"]: c["id"] for c in body["criteria"]}
    got = by_id(member)

    assert got[named["Task completion"]]["score"] == 33.3
    assert got[named["Task completion"]]["detail"] == "1 of 3 tasks done"
    assert got[named["On-time delivery"]]["score"] == 100.0
    # Two were sent for review and one came back.
    assert got[named["Work quality"]]["score"] == 50.0
    assert got[named["Work quality"]]["source"] == "auto"
    # Nothing was scored by a person: they are left out, not counted as zeros.
    manual = got[named["Initiative and responsibility"]]
    assert (manual["score"], manual["source"]) == (None, "none")
    # (33.3 x 25 + 100 x 20 + 50 x 20) / 65 and 65% of the weight was judged.
    assert member["total"] == 59.0
    assert member["coverage"] == 0.65


async def test_a_measure_with_nothing_to_judge_is_never_a_zero(board: Board) -> None:
    work = board.work
    body = await scores(work)
    quiet = row(body, work, "member2")
    assert quiet["total"] is None and quiet["coverage"] == 0
    assert all(s["score"] is None and s["source"] == "none" for s in quiet["scores"])


async def test_the_other_measures(board: Board) -> None:
    work = board.work
    await make_month(board)
    ids = {}
    for name, metric in (
        ("Late", "overdue_rate"),
        ("Stuck", "blocked_tasks"),
        ("Updates", "update_compliance"),
    ):
        response = await work.api(
            "POST", "/performance/criteria", json={"name": name, "weight": 10, "metric": metric}
        )
        assert response.status_code == 201, response.text
        ids[name] = response.json()["id"]
    got = by_id(row(await scores(work), work, "member"))
    # Two of the three tasks already due are late: 100 - 66.7.
    assert got[ids["Late"]]["score"] == 33.3
    assert got[ids["Late"]]["detail"] == "2 of 3 tasks due are late"
    # Nothing is blocked among the two open tasks.
    assert got[ids["Stuck"]]["score"] == 100.0
    # The weekly updates are not recorded yet.
    assert (got[ids["Updates"]]["score"], got[ids["Updates"]]["source"]) == (None, "none")


async def test_a_criterion_that_is_off_is_not_in_the_score(board: Board) -> None:
    work = board.work
    await make_month(board)
    quality = await by_name(work, "Work quality")
    await work.api("PATCH", f"/performance/criteria/{quality['id']}", json={"is_active": False})
    body = await scores(work)
    assert quality["id"] not in {c["id"] for c in body["criteria"]}
    # (33.3 x 25 + 100 x 20) / 45
    assert row(body, work, "member")["total"] == 63.0


# --- manual scores -------------------------------------------------------------------------------


async def test_a_manager_or_an_admin_scores_a_person_with_a_reason(work: Work) -> None:
    await set_manager(work, "member", "wsadmin")
    initiative = await by_name(work, "Initiative and responsibility")

    assert (await give(work, "wsadmin", initiative["id"], "member", 80)).status_code == 204
    got = by_id(row(await scores(work), work, "member"))[initiative["id"]]
    assert (got["score"], got["source"], got["reason"]) == (80.0, "manual", "Good job")
    # 80 x 15 / 15: only that criterion was judged.
    assert row(await scores(work), work, "member")["total"] == 80.0

    # A second score for the same month replaces the first.
    assert (await give(work, "admin", initiative["id"], "member", 60, "Slipped")).status_code == 204
    got = by_id(row(await scores(work), work, "member"))[initiative["id"]]
    assert (got["score"], got["reason"]) == (60.0, "Slipped")


async def test_who_may_not_score(work: Work) -> None:
    await set_manager(work, "member", "wsadmin")
    initiative = await by_name(work, "Initiative and responsibility")
    quality = await by_name(work, "Work quality")
    # Not themselves, not somebody who is not their manager.
    assert_problem(await give(work, "member", initiative["id"], "member", 100), 403)
    assert_problem(await give(work, "member2", initiative["id"], "member", 100), 403)
    # An admin may, even for themselves.
    assert (await give(work, "admin", initiative["id"], "admin", 90)).status_code == 204
    # A criterion measured from the tasks is not scored by hand.
    assert_problem(await give(work, "admin", quality["id"], "member", 90), 422)
    # The reason is required and the score is between 0 and 100.
    assert_problem(await give(work, "admin", initiative["id"], "member", 90, "  "), 422)
    assert_problem(await give(work, "admin", initiative["id"], "member", 101), 422)
    assert_problem(await give(work, "other_admin", initiative["id"], "member", 50), 404)


async def test_everybody_sees_only_the_people_they_may(work: Work) -> None:
    await set_manager(work, "member", "wsadmin")
    everyone = {p["user_id"] for p in (await scores(work, "admin"))["people"]}
    assert str(work.users["member2"]) in everyone and len(everyone) > 3
    # A manager: themselves and the people they manage.
    managed = (await scores(work, "wsadmin"))["people"]
    assert {p["user_id"] for p in managed} == {
        str(work.users["wsadmin"]),
        str(work.users["member"]),
    }
    assert row({"people": managed}, work, "member")["can_score"] is True
    assert row({"people": managed}, work, "wsadmin")["can_score"] is False
    # Anybody else: only themselves.
    mine = (await scores(work, "member2"))["people"]
    assert [p["user_id"] for p in mine] == [str(work.users["member2"])]


async def test_the_period_must_be_a_month(work: Work) -> None:
    assert_problem(await work.api("GET", "/performance/scores", params={"period": "2026-13"}), 422)
    assert_problem(await work.api("GET", "/performance/scores", params={"period": "x"}), 422)
    # Without a period it is the month of the day given.
    body = (await work.api("GET", "/performance/scores", params={"date": "2026-02-10"})).json()
    assert body["period"] == "2026-02"
