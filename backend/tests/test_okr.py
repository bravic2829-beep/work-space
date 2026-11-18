"""OKR: cycles, objectives, key results, check-ins, the review, who sees and who may do what."""

from decimal import Decimal
from typing import Any

import pytest

from app.modules.okr import service
from tests.api_helpers import assert_problem
from tests.work_world import Work

# --- small helpers -------------------------------------------------------------------------------


async def make_cycle(work: Work, name: str = "2026 Q4", who: str = "admin", **extra: Any) -> Any:
    body = {"name": name, "starts_on": "2026-10-01", "ends_on": "2026-12-31", **extra}
    return await work.api("POST", "/okr/cycles", who, json=body)


@pytest.fixture
async def cycle(work: Work) -> dict[str, Any]:
    response = await make_cycle(work)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def make_objective(
    work: Work, cycle: dict[str, Any], who: str = "member", **extra: Any
) -> Any:
    body = {"cycle_id": cycle["id"], "title": "Grow the shop", "level": "personal", **extra}
    return await work.api("POST", "/okr/objectives", who, json=body)


async def objective(
    work: Work, cycle: dict[str, Any], who: str = "member", **extra: Any
) -> dict[str, Any]:
    response = await make_objective(work, cycle, who, **extra)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def add_kr(
    work: Work, obj: dict[str, Any], who: str = "member", **extra: Any
) -> dict[str, Any]:
    """Add a key result; returns the objective as the API answers."""
    body = {"title": "Reach 100 customers", "start_value": 0, "target_value": 100, **extra}
    response = await work.api("POST", f"/okr/objectives/{obj['id']}/key-results", who, json=body)
    assert response.status_code == 201, response.text
    answer: dict[str, Any] = response.json()
    return answer


async def check_in(work: Work, kr_id: str, value: float, who: str = "member", **extra: Any) -> Any:
    return await work.api(
        "POST", f"/okr/key-results/{kr_id}/check-ins", who, json={"value": value, **extra}
    )


async def overview(work: Work, cycle: dict[str, Any], who: str = "admin", **params: Any) -> Any:
    response = await work.api(
        "GET", "/okr/overview", who, params={"cycle_id": cycle["id"], **params}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def set_manager(work: Work, employee: str, manager: str) -> None:
    response = await work.api(
        "PATCH", f"/users/{work.users[employee]}", json={"manager_id": str(work.users[manager])}
    )
    assert response.status_code == 200, response.text


async def make_department(work: Work, head: str) -> str:
    response = await work.api(
        "POST",
        "/departments",
        json={"name": "Sales", "kind": "division", "head_user_id": str(work.users[head])},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


# --- the arithmetic ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("start", "target", "now", "expected"),
    [
        ("0", "100", "0", 0.0),
        ("0", "100", "50", 0.5),
        ("0", "100", "100", 1.0),
        ("0", "100", "250", 1.0),  # beyond the target is still complete
        ("0", "100", "-30", 0.0),  # going backwards is not negative progress
        ("100", "500", "300", 0.5),  # the start is not zero
        ("10", "2", "6", 0.5),  # a target below the start: bring the errors down
        ("10", "2", "10", 0.0),
        ("10", "2", "1", 1.0),
        ("5", "5", "5", 0.0),  # no span: nothing to measure
        ("0", "3", "1", 0.3333),  # four decimals
    ],
)
def test_progress_of_a_key_result(start: str, target: str, now: str, expected: float) -> None:
    assert service.progress(Decimal(start), Decimal(target), Decimal(now)) == expected


# --- cycles --------------------------------------------------------------------------------------


async def test_an_admin_opens_cycles_and_everybody_reads_them(work: Work) -> None:
    created = await make_cycle(work)
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["name"], body["status"], body["starts_on"]) == ("2026 Q4", "open", "2026-10-01")

    for who in ("member", "viewer", "wsadmin"):
        listed = await work.api("GET", "/okr/cycles", who)
        assert [c["name"] for c in listed.json()] == ["2026 Q4"]
    # Another company sees none of them.
    assert (await work.api("GET", "/okr/cycles", "other_admin")).json() == []


async def test_only_an_admin_manages_cycles(work: Work, cycle: dict[str, Any]) -> None:
    assert_problem(await make_cycle(work, "2027 Q1", "member"), 403)
    url = f"/okr/cycles/{cycle['id']}"
    assert_problem(await work.api("PATCH", url, "wsadmin", json={"name": "x"}), 403)
    assert_problem(await work.api("DELETE", url, "member"), 403)


async def test_a_cycle_is_checked(work: Work, cycle: dict[str, Any]) -> None:
    assert_problem(await make_cycle(work, "2027 Q1", ends_on="2026-09-30"), 422)  # ends first
    assert_problem(await make_cycle(work, "  2026 q4  "), 409)  # same name, any case
    assert_problem(await make_cycle(work, ""), 422)
    other = await work.api(
        "POST",
        "/okr/cycles",
        "other_admin",
        json={"name": "2026 Q4", "starts_on": "2026-10-01", "ends_on": "2026-12-31"},
    )
    assert other.status_code == 201  # the name is free in another company


async def test_a_cycle_can_be_changed_closed_and_deleted_when_empty(
    work: Work, cycle: dict[str, Any]
) -> None:
    url = f"/okr/cycles/{cycle['id']}"
    changed = await work.api("PATCH", url, json={"name": "Q4 2026", "ends_on": "2026-12-15"})
    assert changed.json()["name"] == "Q4 2026"
    assert changed.json()["ends_on"] == "2026-12-15"
    assert_problem(await work.api("PATCH", url, json={"ends_on": "2026-01-01"}), 422)
    assert_problem(await work.api("PATCH", url, json={"name": None}), 422)

    await objective(work, cycle)
    assert_problem(await work.api("DELETE", url), 409)  # it has an objective
    empty = (await make_cycle(work, "Spare")).json()
    assert (await work.api("DELETE", f"/okr/cycles/{empty['id']}")).status_code == 204
    assert_problem(await work.api("GET", "/okr/overview", params={"cycle_id": empty["id"]}), 404)


# --- objectives: who may make which --------------------------------------------------------------


async def test_a_person_makes_their_own_objective(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle, "member", description="The shop first")
    assert obj["owner"]["id"] == str(work.users["member"])
    assert (obj["level"], obj["progress"], obj["key_results"]) == ("personal", None, [])
    assert obj["can_edit"] is True and obj["can_review"] is False


async def test_a_personal_objective_is_for_oneself_unless_an_admin_makes_it(
    work: Work, cycle: dict[str, Any]
) -> None:
    other = {"owner_id": str(work.users["member2"])}
    assert_problem(await make_objective(work, cycle, "member", **other), 403)
    made = await objective(work, cycle, "admin", **other)
    assert made["owner"]["id"] == str(work.users["member2"])


async def test_only_an_admin_makes_company_objectives(work: Work, cycle: dict[str, Any]) -> None:
    assert_problem(await make_objective(work, cycle, "wsadmin", level="company"), 403)
    assert (await make_objective(work, cycle, "admin", level="company")).status_code == 201


async def test_a_department_objective_is_made_by_its_head_or_an_admin(
    work: Work, cycle: dict[str, Any]
) -> None:
    department = await make_department(work, "editor")
    kwargs = {"level": "department", "department_id": department}
    assert_problem(await make_objective(work, cycle, "member", **kwargs), 403)
    assert (await make_objective(work, cycle, "editor", **kwargs)).status_code == 201
    assert (await make_objective(work, cycle, "admin", **kwargs)).status_code == 201
    # The department is required for this level and refused for the others.
    assert_problem(await make_objective(work, cycle, "admin", level="department"), 422)
    assert_problem(await make_objective(work, cycle, "member", department_id=department), 422)
    unknown = "00000000-0000-0000-0000-000000000000"
    assert_problem(
        await make_objective(work, cycle, "admin", level="department", department_id=unknown), 422
    )


async def test_the_owner_must_be_somebody_who_can_own_it(work: Work, cycle: dict[str, Any]) -> None:
    ghost = {"owner_id": "00000000-0000-0000-0000-000000000000"}
    assert_problem(await make_objective(work, cycle, "admin", **ghost), 422)
    foreign = {"owner_id": str(work.other["user_id"])}
    assert_problem(await make_objective(work, cycle, "admin", **foreign), 422)


async def test_the_input_is_checked(work: Work, cycle: dict[str, Any]) -> None:
    assert_problem(await make_objective(work, cycle, title=""), 422)
    assert_problem(await make_objective(work, cycle, level="galaxy"), 422)
    assert_problem(await make_objective(work, cycle, color="red"), 422)  # unknown field
    missing = {"cycle_id": "00000000-0000-0000-0000-000000000000"}
    response = await work.api(
        "POST", "/okr/objectives", json={"title": "x", "level": "company", **missing}
    )
    assert_problem(response, 404)


# --- editing an objective ------------------------------------------------------------------------


async def test_the_owner_edits_and_others_cannot(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle, "member")
    url = f"/okr/objectives/{obj['id']}"
    edited = await work.api("PATCH", url, "member", json={"title": "Grow", "description": None})
    assert edited.status_code == 200, edited.text
    assert edited.json()["title"] == "Grow"
    assert_problem(await work.api("PATCH", url, "member2", json={"title": "Mine now"}), 403)
    assert_problem(await work.api("DELETE", url, "member2"), 403)
    assert_problem(await work.api("PATCH", url, "member", json={"title": None}), 422)
    assert (await work.api("PATCH", url, "admin", json={"is_private": False})).status_code == 200


async def test_the_head_of_a_department_edits_its_objectives(
    work: Work, cycle: dict[str, Any]
) -> None:
    department = await make_department(work, "editor")
    obj = await objective(work, cycle, "admin", level="department", department_id=department)
    url = f"/okr/objectives/{obj['id']}"
    assert (await work.api("PATCH", url, "editor", json={"title": "Sell more"})).status_code == 200
    assert_problem(await work.api("PATCH", url, "member", json={"title": "x"}), 403)


async def test_only_an_admin_gives_an_objective_away_or_changes_its_level(
    work: Work, cycle: dict[str, Any]
) -> None:
    obj = await objective(work, cycle, "member")
    url = f"/okr/objectives/{obj['id']}"
    give = {"owner_id": str(work.users["member2"])}
    assert_problem(await work.api("PATCH", url, "member", json=give), 403)
    assert_problem(await work.api("PATCH", url, "member", json={"level": "company"}), 403)
    moved = await work.api("PATCH", url, "admin", json=give)
    assert moved.json()["owner"]["id"] == str(work.users["member2"])
    company = await work.api("PATCH", url, "admin", json={"level": "company"})
    assert company.json()["level"] == "company"


async def test_deleting_an_objective_takes_its_key_results(
    work: Work, cycle: dict[str, Any]
) -> None:
    obj = await objective(work, cycle)
    await add_kr(work, obj)
    assert (await work.api("DELETE", f"/okr/objectives/{obj['id']}", "member")).status_code == 204
    assert_problem(await work.api("GET", f"/okr/objectives/{obj['id']}", "member"), 404)
    assert (await overview(work, cycle))["objectives"] == []


# --- key results and progress --------------------------------------------------------------------


async def test_a_key_result_starts_at_its_start_value(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle)
    answer = await add_kr(work, obj, start_value=20, target_value=120, unit="customers")
    kr = answer["key_results"][0]
    assert (kr["start_value"], kr["target_value"], kr["current_value"]) == (20.0, 120.0, 20.0)
    assert (kr["progress"], kr["status"], kr["unit"]) == (0.0, "on_track", "customers")
    assert kr["owner"]["id"] == str(work.users["member"])  # the owner of the objective
    assert answer["progress"] == 0.0


async def test_an_objective_averages_its_key_results(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle)
    first = (await add_kr(work, obj))["key_results"][0]
    answer = await add_kr(work, obj, title="Cut the returns", start_value=10, target_value=2)
    second = answer["key_results"][1]
    await check_in(work, first["id"], 50)  # 0.5
    done = await check_in(work, second["id"], 2)  # 1.0, going down
    assert done.status_code == 201, done.text
    assert done.json()["progress"] == 0.75
    assert [k["progress"] for k in done.json()["key_results"]] == [0.5, 1.0]


async def test_a_key_result_is_checked(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle)
    url = f"/okr/objectives/{obj['id']}/key-results"
    same = {"title": "x", "start_value": 5, "target_value": 5}
    assert_problem(await work.api("POST", url, "member", json=same), 422)
    assert_problem(
        await work.api("POST", url, "member", json={"title": "", "target_value": 1}), 422
    )
    assert_problem(await work.api("POST", url, "member", json={"title": "x"}), 422)  # no target
    huge = {"title": "x", "target_value": 1e30}
    assert_problem(await work.api("POST", url, "member", json=huge), 422)
    nobody = {"title": "x", "target_value": 1, "owner_id": "00000000-0000-0000-0000-000000000000"}
    assert_problem(await work.api("POST", url, "member", json=nobody), 422)
    assert_problem(
        await work.api("POST", url, "member2", json={"title": "x", "target_value": 1}), 403
    )


async def test_an_objective_holds_a_limited_number_of_key_results(
    work: Work, cycle: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "MAX_KEY_RESULTS", 2)
    obj = await objective(work, cycle)
    await add_kr(work, obj)
    await add_kr(work, obj)
    response = await work.api(
        "POST",
        f"/okr/objectives/{obj['id']}/key-results",
        "member",
        json={"title": "One too many", "target_value": 1},
    )
    assert_problem(response, 409)


async def test_the_targets_of_a_key_result_change_its_progress(
    work: Work, cycle: dict[str, Any]
) -> None:
    obj = await objective(work, cycle)
    kr = (await add_kr(work, obj))["key_results"][0]
    await check_in(work, kr["id"], 50)
    url = f"/okr/key-results/{kr['id']}"
    changed = await work.api("PATCH", url, "member", json={"target_value": 200, "title": "Bigger"})
    assert changed.status_code == 200, changed.text
    again = changed.json()["key_results"][0]
    assert (again["progress"], again["title"], again["current_value"]) == (0.25, "Bigger", 50.0)
    assert_problem(await work.api("PATCH", url, "member", json={"target_value": 0}), 422)  # = start
    assert_problem(await work.api("PATCH", url, "member", json={"title": None}), 422)
    assert_problem(await work.api("PATCH", url, "member2", json={"title": "x"}), 403)


async def test_a_key_result_can_belong_to_somebody_else(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle)
    answer = await add_kr(work, obj, owner_id=str(work.users["member2"]))
    kr = answer["key_results"][0]
    assert kr["owner"]["id"] == str(work.users["member2"])
    # They update their own key result, but do not edit the objective around it.
    assert kr["can_check_in"] is True  # the reader here owns the objective
    assert (await check_in(work, kr["id"], 10, "member2")).status_code == 201
    url = f"/okr/key-results/{kr['id']}"
    assert_problem(await work.api("PATCH", url, "member2", json={"title": "Mine"}), 403)
    assert_problem(await work.api("DELETE", url, "member2"), 403)
    assert (await work.api("DELETE", url, "member")).status_code == 204


# --- check-ins -----------------------------------------------------------------------------------


async def test_a_check_in_moves_the_key_result_and_is_kept(
    work: Work, cycle: dict[str, Any]
) -> None:
    obj = await objective(work, cycle)
    kr = (await add_kr(work, obj))["key_results"][0]
    first = await check_in(work, kr["id"], 30, note="Slow start")
    assert first.status_code == 201, first.text
    mid = first.json()["key_results"][0]
    assert (mid["current_value"], mid["progress"], mid["status"]) == (30.0, 0.3, "on_track")
    assert mid["last_check_in_at"] is not None

    second = await check_in(work, kr["id"], 55, status="at_risk", note="Behind plan")
    assert second.json()["key_results"][0]["status"] == "at_risk"
    # Without a status it stays what it was.
    third = await check_in(work, kr["id"], 60)
    assert third.json()["key_results"][0]["status"] == "at_risk"

    history = (await work.api("GET", f"/okr/key-results/{kr['id']}/check-ins", "member2")).json()
    assert [(h["value"], h["status"], h["note"]) for h in history] == [
        (60.0, "at_risk", None),
        (55.0, "at_risk", "Behind plan"),
        (30.0, "on_track", "Slow start"),
    ]
    assert history[0]["author"]["id"] == str(work.users["member"])


async def test_who_may_check_in(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle, "member")
    kr = (await add_kr(work, obj))["key_results"][0]
    assert_problem(await check_in(work, kr["id"], 5, "member2"), 403)
    assert (await check_in(work, kr["id"], 5, "admin")).status_code == 201
    assert_problem(await check_in(work, "00000000-0000-0000-0000-000000000000", 1), 404)
    assert_problem(await check_in(work, kr["id"], 5, status="great"), 422)
    assert_problem(
        await work.api("POST", f"/okr/key-results/{kr['id']}/check-ins", "member", json={}), 422
    )


async def test_nothing_changes_in_a_closed_cycle_but_the_review(
    work: Work, cycle: dict[str, Any]
) -> None:
    obj = await objective(work, cycle, "member")
    kr = (await add_kr(work, obj))["key_results"][0]
    closed = await work.api("PATCH", f"/okr/cycles/{cycle['id']}", json={"status": "closed"})
    assert closed.json()["status"] == "closed"

    assert_problem(await check_in(work, kr["id"], 5), 409)
    assert_problem(await add_kr_raw(work, obj), 409)
    assert_problem(
        await work.api("PATCH", f"/okr/objectives/{obj['id']}", json={"title": "x"}), 409
    )
    assert_problem(await work.api("DELETE", f"/okr/objectives/{obj['id']}"), 409)
    assert_problem(await make_objective(work, cycle, "member"), 409)
    # The review is written at the end, so it is still allowed; and an admin can reopen.
    reviewed = await work.api("PATCH", f"/okr/objectives/{obj['id']}/review", json={"score": 0.7})
    assert reviewed.status_code == 200, reviewed.text
    await work.api("PATCH", f"/okr/cycles/{cycle['id']}", json={"status": "open"})
    assert (await check_in(work, kr["id"], 5)).status_code == 201


async def add_kr_raw(work: Work, obj: dict[str, Any]) -> Any:
    return await work.api(
        "POST",
        f"/okr/objectives/{obj['id']}/key-results",
        "member",
        json={"title": "Late", "target_value": 10},
    )


# --- who sees what -------------------------------------------------------------------------------


async def test_everybody_sees_the_objectives_that_are_not_private(
    work: Work, cycle: dict[str, Any]
) -> None:
    await objective(work, cycle, "member", title="Open one")
    for who in ("member2", "viewer", "wsadmin", "admin"):
        titles = [o["title"] for o in (await overview(work, cycle, who))["objectives"]]
        assert titles == ["Open one"], who


async def test_a_private_objective_is_seen_only_by_the_people_around_it(
    work: Work, cycle: dict[str, Any]
) -> None:
    await set_manager(work, "member", "wsadmin")
    obj = await objective(work, cycle, "member", title="Secret", is_private=True)
    kr_owner = {"owner_id": str(work.users["editor"])}
    await add_kr(work, obj, **kr_owner)

    def titles(body: Any) -> list[str]:
        return [o["title"] for o in body["objectives"]]

    # Its owner, an admin, the owner's manager and the owner of one of its key results.
    for who in ("member", "admin", "wsadmin", "editor"):
        assert titles(await overview(work, cycle, who)) == ["Secret"], who
        assert (await work.api("GET", f"/okr/objectives/{obj['id']}", who)).status_code == 200
    # Nobody else: the objective is not in the list, and it is not even said to exist.
    for who in ("member2", "viewer", "commenter"):
        assert titles(await overview(work, cycle, who)) == [], who
        assert_problem(await work.api("GET", f"/okr/objectives/{obj['id']}", who), 404)
        assert_problem(await work.api("PATCH", f"/okr/objectives/{obj['id']}", who, json={}), 404)
    assert_problem(await work.api("GET", f"/okr/objectives/{obj['id']}", "other_admin"), 404)


async def test_a_company_cannot_see_the_okrs_of_another(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle, "member")
    assert_problem(await work.api("GET", f"/okr/objectives/{obj['id']}", "other_admin"), 404)
    other = await work.api("GET", "/okr/overview", "other_admin", params={"cycle_id": cycle["id"]})
    assert_problem(other, 404)


# --- the review ----------------------------------------------------------------------------------


async def test_the_owner_cannot_review_their_own_work(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle, "member")
    kr = (await add_kr(work, obj))["key_results"][0]
    mine = {"score": 1}
    assert_problem(
        await work.api("PATCH", f"/okr/objectives/{obj['id']}/review", "member", json=mine), 403
    )
    assert_problem(
        await work.api("PATCH", f"/okr/key-results/{kr['id']}/review", "member", json=mine), 403
    )
    assert_problem(
        await work.api("PATCH", f"/okr/objectives/{obj['id']}/review", "member2", json=mine), 403
    )


async def test_an_admin_a_manager_or_the_objective_above_reviews(
    work: Work, cycle: dict[str, Any]
) -> None:
    await set_manager(work, "member", "wsadmin")
    top = await objective(work, cycle, "editor", level="personal")
    obj = await objective(work, cycle, "member", parent_id=top["id"])
    url = f"/okr/objectives/{obj['id']}/review"
    body = {"score": 0.8, "merits": "Clear goal", "to_improve": "Start earlier"}
    for who in ("admin", "wsadmin", "editor"):  # an admin, the manager, the owner of the parent
        done = await work.api("PATCH", url, who, json=body)
        assert done.status_code == 200, (who, done.text)
    result = done.json()
    assert (result["score"], result["merits"], result["to_improve"]) == (
        0.8,
        "Clear goal",
        "Start earlier",
    )
    # The owner reads it.
    seen = (await work.api("GET", f"/okr/objectives/{obj['id']}", "member")).json()
    assert seen["score"] == 0.8 and seen["can_review"] is False


async def test_the_review_changes_only_what_is_sent_and_can_be_cleared(
    work: Work, cycle: dict[str, Any]
) -> None:
    obj = await objective(work, cycle, "member")
    url = f"/okr/objectives/{obj['id']}/review"
    await work.api("PATCH", url, json={"score": 0.5, "merits": "Good", "to_improve": "More"})
    only_score = await work.api("PATCH", url, json={"score": 0.9})
    assert (only_score.json()["score"], only_score.json()["merits"]) == (0.9, "Good")
    cleared = await work.api("PATCH", url, json={"score": None, "merits": ""})
    assert (cleared.json()["score"], cleared.json()["merits"]) == (None, None)
    assert cleared.json()["to_improve"] == "More"
    for bad in ({"score": 1.5}, {"score": -0.1}, {"score": "high"}, {"mark": 1}):
        assert_problem(await work.api("PATCH", url, json=bad), 422)


async def test_a_key_result_is_reviewed_on_its_own(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle, "member")
    kr = (await add_kr(work, obj))["key_results"][0]
    done = await work.api(
        "PATCH", f"/okr/key-results/{kr['id']}/review", json={"score": 0.6, "merits": "Steady"}
    )
    assert done.status_code == 200, done.text
    assert done.json()["key_results"][0]["score"] == 0.6
    assert done.json()["score"] is None  # the objective has its own


# --- alignment -----------------------------------------------------------------------------------


async def test_an_objective_supports_one_above_it(work: Work, cycle: dict[str, Any]) -> None:
    company = await objective(work, cycle, "admin", level="company", title="Be the best")
    team = await objective(
        work, cycle, "admin", level="company", title="Team", parent_id=company["id"]
    )
    mine = await objective(work, cycle, "member", parent_id=team["id"])
    assert (team["parent_id"], mine["parent_id"]) == (company["id"], team["id"])
    # Not upwards: a personal objective cannot be supported by a company one it is not below,
    # and a company objective cannot support a personal one.
    assert_problem(
        await work.api("PATCH", f"/okr/objectives/{company['id']}", json={"parent_id": mine["id"]}),
        422,
    )


async def test_the_alignment_is_checked(work: Work, cycle: dict[str, Any]) -> None:
    other_cycle = (
        await make_cycle(work, "2027 Q1", starts_on="2027-01-01", ends_on="2027-03-31")
    ).json()
    foreign = await objective(work, other_cycle, "member")
    obj = await objective(work, cycle, "member")
    url = f"/okr/objectives/{obj['id']}"
    assert_problem(await work.api("PATCH", url, "member", json={"parent_id": obj["id"]}), 422)
    assert_problem(await work.api("PATCH", url, "member", json={"parent_id": foreign["id"]}), 422)
    missing = "00000000-0000-0000-0000-000000000000"
    assert_problem(await work.api("PATCH", url, "member", json={"parent_id": missing}), 422)
    child = await objective(work, cycle, "member", parent_id=obj["id"])
    # No loop: the parent cannot be placed under its own child.
    assert_problem(await work.api("PATCH", url, "member", json={"parent_id": child["id"]}), 422)
    # A level below cannot be above: personal under a department is fine, the reverse is not.
    assert_problem(
        await make_objective(work, cycle, "admin", level="company", parent_id=obj["id"]), 422
    )


async def test_removing_the_parent_makes_the_child_a_root(
    work: Work, cycle: dict[str, Any]
) -> None:
    parent = await objective(work, cycle, "member")
    child = await objective(work, cycle, "member2", parent_id=parent["id"])
    assert (
        await work.api("DELETE", f"/okr/objectives/{parent['id']}", "member")
    ).status_code == 204
    after = (await work.api("GET", f"/okr/objectives/{child['id']}", "member2")).json()
    assert after["parent_id"] is None
    cleared = await work.api(
        "PATCH", f"/okr/objectives/{child['id']}", "member2", json={"parent_id": None}
    )
    assert cleared.status_code == 200


async def test_a_reader_is_not_told_about_a_parent_they_cannot_see(
    work: Work, cycle: dict[str, Any]
) -> None:
    parent = await objective(work, cycle, "member", is_private=True)
    child = await objective(work, cycle, "admin", parent_id=parent["id"])
    admin_view = (await work.api("GET", f"/okr/objectives/{child['id']}", "admin")).json()
    assert admin_view["parent_id"] == parent["id"]
    other_view = (await work.api("GET", f"/okr/objectives/{child['id']}", "member2")).json()
    assert other_view["parent_id"] is None


# --- the overview --------------------------------------------------------------------------------


async def test_the_overview_adds_up_a_cycle(work: Work, cycle: dict[str, Any]) -> None:
    first = await objective(work, cycle, "member", title="A")
    second = await objective(work, cycle, "member2", title="B")
    await objective(work, cycle, "editor", title="No key results yet")
    kr1 = (await add_kr(work, first))["key_results"][0]
    kr2 = (await add_kr(work, first, title="Second"))["key_results"][1]
    kr3 = (await add_kr(work, second, "member2"))["key_results"][0]
    await check_in(work, kr1["id"], 100)  # done
    await check_in(work, kr2["id"], 50, status="at_risk")
    await check_in(work, kr3["id"], 20, "member2", status="off_track")
    await work.api("PATCH", f"/okr/objectives/{first['id']}/review", json={"score": 0.9})

    body = await overview(work, cycle, "viewer")
    assert body["cycle"]["name"] == "2026 Q4"
    summary = body["summary"]
    assert (summary["objectives"], summary["key_results"]) == (3, 3)
    assert (summary["on_track"], summary["at_risk"], summary["off_track"]) == (1, 1, 1)
    assert summary["reviewed"] == 1
    # (0.75 + 0.2) / 2: the objective with no key results is not counted as 0.
    assert summary["progress"] == 0.475
    by_title = {o["title"]: o for o in body["objectives"]}
    assert by_title["A"]["progress"] == 0.75
    assert by_title["No key results yet"]["progress"] is None


async def test_the_risky_view_keeps_only_the_key_results_in_trouble(
    work: Work, cycle: dict[str, Any]
) -> None:
    obj = await objective(work, cycle, "member", title="Mixed")
    fine = (await add_kr(work, obj, title="Fine"))["key_results"][0]
    shaky = (await add_kr(work, obj, title="Shaky"))["key_results"][1]
    await objective(work, cycle, "member2", title="All good")
    await check_in(work, fine["id"], 80)
    await check_in(work, shaky["id"], 10, status="at_risk")

    body = await overview(work, cycle, kr_status=["at_risk", "off_track"])
    assert [o["title"] for o in body["objectives"]] == ["Mixed"]
    assert [k["title"] for k in body["objectives"][0]["key_results"]] == ["Shaky"]
    assert body["summary"]["key_results"] == 1
    # The progress of the objective still counts all its key results.
    assert body["objectives"][0]["progress"] == 0.45


async def test_the_overview_can_be_narrowed(work: Work, cycle: dict[str, Any]) -> None:
    department = await make_department(work, "editor")
    await objective(work, cycle, "admin", level="company", title="Company")
    await objective(
        work, cycle, "admin", level="department", department_id=department, title="Dept"
    )
    mine = await objective(work, cycle, "member", title="Mine")
    await add_kr(work, mine, owner_id=str(work.users["member2"]))
    await objective(work, cycle, "editor", title="Theirs")

    def titles(body: Any) -> list[str]:
        return [o["title"] for o in body["objectives"]]

    assert titles(await overview(work, cycle, level="company")) == ["Company"]
    assert titles(await overview(work, cycle, level="department", department_id=department)) == [
        "Dept"
    ]
    assert titles(await overview(work, cycle, owner_id=str(work.users["editor"]))) == ["Theirs"]
    # Who works on it: the owner of the objective and the owners of its key results.
    assert titles(await overview(work, cycle, "member2", mine="true")) == ["Mine"]
    assert titles(await overview(work, cycle, "member", mine="true")) == ["Mine"]
    assert titles(await overview(work, cycle, "viewer", mine="true")) == []
    assert_problem(
        await work.api("GET", "/okr/overview", params={"cycle_id": cycle["id"], "level": "x"}), 422
    )


async def test_objectives_come_in_the_order_they_were_made_or_placed(
    work: Work, cycle: dict[str, Any]
) -> None:
    a = await objective(work, cycle, title="A")
    await objective(work, cycle, title="B")
    await objective(work, cycle, title="C")
    assert [o["title"] for o in (await overview(work, cycle))["objectives"]] == ["A", "B", "C"]
    await work.api("PATCH", f"/okr/objectives/{a['id']}", "member", json={"position": 9})
    assert [o["title"] for o in (await overview(work, cycle))["objectives"]] == ["B", "C", "A"]


# --- login ---------------------------------------------------------------------------------------


async def test_everything_needs_a_login(work: Work, cycle: dict[str, Any]) -> None:
    obj = await objective(work, cycle)
    for method, url in (
        ("GET", "/api/v1/okr/cycles"),
        ("GET", f"/api/v1/okr/overview?cycle_id={cycle['id']}"),
        ("GET", f"/api/v1/okr/objectives/{obj['id']}"),
        ("POST", "/api/v1/okr/objectives"),
    ):
        response = await work.client.request(method, url, json={})
        assert response.status_code == 401, (method, url)


# --- departments ---------------------------------------------------------------------------------


async def test_everybody_reads_the_department_names_and_sees_where_they_may_create(
    work: Work,
) -> None:
    department = await make_department(work, "editor")
    for who, may in (("admin", True), ("editor", True), ("member", False), ("viewer", False)):
        listed = (await work.api("GET", "/okr/departments", who)).json()
        assert [(d["id"], d["name"], d["can_create"]) for d in listed] == [
            (department, "Sales", may)
        ], who
    foreign = (await work.api("GET", "/okr/departments", "other_admin")).json()
    assert [d["name"] for d in foreign] == ["Other division"]  # never ours
