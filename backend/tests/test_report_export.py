"""The Excel file of a report: what it holds, who gets which rows and columns, and its safety."""

from io import BytesIO
from typing import Any

import pytest
from openpyxl import load_workbook
from openpyxl.workbook.workbook import Workbook

from app.modules.reports import export
from tests.api_helpers import assert_problem
from tests.test_records import Board
from tests.test_sheets import make_sheet
from tests.work_world import Work

TODAY = "2026-11-14"


@pytest.fixture
async def board(work: Work) -> Board:
    base_id = await work.make_base()
    return Board(work, await work.make_table(base_id, "Tasks", template="tasks"))


async def fetch(board: Board, who: str = "admin") -> Any:
    return await board.work.api(
        "GET", "/reports/export", who, params={"table_id": board.id, "date": TODAY}
    )


async def book(board: Board, who: str = "admin") -> Workbook:
    response = await fetch(board, who)
    assert response.status_code == 200, response.text
    return load_workbook(BytesIO(response.content))


def table(workbook: Workbook, sheet: str) -> list[dict[str, Any]]:
    """A sheet as a list of rows, each keyed by the heading of its column."""
    rows = list(workbook[sheet].iter_rows(values_only=True))
    heads = [str(h) for h in rows[0]]
    return [dict(zip(heads, row, strict=True)) for row in rows[1:]]


# --- what the file holds ------------------------------------------------------------------------


async def test_the_file_has_the_totals_the_people_and_the_tasks(board: Board) -> None:
    s = board.status_options
    m = board.user("member")
    await board.create(
        Name="Late", Assignee=[m], Status=s["In progress"], **{"Due date": "2026-11-10"}
    )
    await board.create(Name="Stuck", Assignee=[m], Status=s["Blocked"])
    await board.create(Name="Nobody's")

    workbook = await book(board)
    assert workbook.sheetnames == ["Summary", "By status", "Work per person", "Tasks"]

    summary = {r["Item"]: r["Value"] for r in table(workbook, "Summary")}
    assert summary["Table"] == "Tasks"
    assert summary["Counted on"] == TODAY
    assert (summary["Tasks counted"], summary["Open"], summary["Overdue"]) == (3, 3, 1)
    assert (summary["Blocked"], summary["Unassigned"]) == (1, 1)

    statuses = {r["Status"]: r["Tasks"] for r in table(workbook, "By status")}
    assert statuses["Blocked"] == 1

    people = table(workbook, "Work per person")
    assert len(people) == 1
    assert (people[0]["Open"], people[0]["Overdue"], people[0]["Blocked"]) == (2, 1, 1)

    tasks = {r["Name"]: r for r in table(workbook, "Tasks")}
    assert set(tasks) == {"Late", "Stuck", "Nobody's"}
    assert tasks["Late"]["Status"] == "In progress"
    assert tasks["Late"]["Due date"] == "2026-11-10"
    assert tasks["Stuck"]["Status"] == "Blocked"
    # A person is written as a name with their code, not as an id.
    assert tasks["Late"]["Assignee"].endswith(")") and "(" in tasks["Late"]["Assignee"]
    assert tasks["Nobody's"]["Assignee"] in (None, "")


async def test_a_timer_makes_three_columns(board: Board) -> None:
    task = await board.create(Name="Timed", Assignee=[board.user("member")])
    timer = board.f["Timer"]
    started = await board.work.api(
        "POST",
        f"/records/{task['id']}/timer",
        "admin",
        json={"action": "start", "field_id": timer},
        headers={"If-Match": f'"{task["version"]}"'},
    )
    assert started.status_code == 200, started.text

    heads = [c.value for c in (await book(board))["Tasks"][1]]
    assert {"Timer: started", "Timer: finished", "Timer: hours"} <= set(heads)
    row = table(await book(board), "Tasks")[0]
    assert row["Timer: started"] and not row["Timer: finished"]


async def test_the_response_is_a_download(board: Board) -> None:
    await board.create(Name="One")
    response = await fetch(board)
    assert response.status_code == 200
    assert response.headers["content-type"] == export.XLSX
    assert response.headers["content-disposition"] == (
        f'attachment; filename="report-Tasks-{TODAY}.xlsx"'
    )
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    assert response.content[:2] == b"PK"  # an .xlsx file is a zip


def test_the_file_name_is_plain_ascii() -> None:
    assert export.filename_for("Công việc", TODAY) == f"report-Cong-viec-{TODAY}.xlsx"
    assert export.filename_for("Đơn hàng / Q4", TODAY) == f"report-Don-hang-Q4-{TODAY}.xlsx"
    assert export.filename_for("日本語", TODAY) == f"report-tasks-{TODAY}.xlsx"
    assert export.filename_for('a"b\r\nc', TODAY) == f"report-a-b-c-{TODAY}.xlsx"


# --- safety ---------------------------------------------------------------------------------


async def test_a_text_is_never_a_formula(board: Board) -> None:
    await board.create(Name='=HYPERLINK("http://evil.example","click")')
    await board.create(Name="+1+1")
    await board.create(Name="@SUM(1)")
    await board.create(Name="-2+3")

    sheet = (await book(board))["Tasks"]
    name_column = next(c.column for c in sheet[1] if c.value == "Name")
    cells = [sheet.cell(row=r, column=name_column) for r in range(2, sheet.max_row + 1)]
    assert len(cells) == 4
    for cell in cells:
        assert cell.data_type == "s", (cell.value, cell.data_type)
    assert {c.value for c in cells} == {
        '=HYPERLINK("http://evil.example","click")',
        "+1+1",
        "@SUM(1)",
        "-2+3",
    }


async def test_characters_a_file_cannot_hold_do_not_break_it(board: Board) -> None:
    await board.create(Name="bell\x07 and form\x0cfeed")
    names = [r["Name"] for r in table(await book(board), "Tasks")]
    assert names == ["bell and formfeed"]


async def test_a_very_long_text_is_cut_to_what_a_cell_holds(board: Board) -> None:
    await board.create(Name="x", **{"Progress update": "y" * 40_000})
    row = table(await book(board), "Tasks")[0]
    assert len(row["Progress update"]) == export.MAX_TEXT


async def test_a_big_table_is_cut_and_says_so(
    board: Board, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(export, "MAX_TASKS", 2)
    for name in ("a", "b", "c"):
        await board.create(Name=name)
    workbook = await book(board)
    assert [r["Name"] for r in table(workbook, "Tasks")] == ["a", "b"]
    notes = [r["Value"] for r in table(workbook, "Summary") if r["Item"] == "Note"]
    assert notes and "first 2 tasks" in notes[0]


# --- who gets what ------------------------------------------------------------------------------


async def test_the_file_holds_only_the_tasks_the_reader_may_open(board: Board) -> None:
    await make_sheet(board, "member")
    await board.create(Name="Mine", Assignee=[board.user("member")])
    await board.create(Name="Not mine", Assignee=[board.user("member2")])

    assert {r["Name"] for r in table(await book(board, "admin"), "Tasks")} == {"Mine", "Not mine"}
    mine = await book(board, "member")
    assert [r["Name"] for r in table(mine, "Tasks")] == ["Mine"]
    summary = {r["Item"]: r["Value"] for r in table(mine, "Summary")}
    assert summary["Tasks counted"] == 1
    # The people table does not name the colleague whose task the reader cannot open.
    assert len(table(mine, "Work per person")) == 1


async def test_a_column_hidden_from_the_reader_is_not_in_the_file(board: Board) -> None:
    await make_sheet(board, "member")
    await board.create(
        Name="Mine", Assignee=[board.user("member")], **{"Progress update": "secret plan"}
    )
    hidden = await board.work.api(
        "PUT",
        f"/fields/{board.f['Progress update']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert hidden.status_code == 200, hidden.text

    mine = await book(board, "member")
    heads = [c.value for c in mine["Tasks"][1]]
    assert "Progress update" not in heads
    assert "secret plan" not in str([[c.value for c in row] for row in mine["Tasks"].iter_rows()])
    # The admin still gets the column.
    assert "Progress update" in [c.value for c in (await book(board))["Tasks"][1]]


async def test_a_number_that_needs_a_hidden_column_is_a_dash(board: Board) -> None:
    await make_sheet(board, "member")
    await board.create(Name="Mine", Assignee=[board.user("member")])
    hidden = await board.work.api(
        "PUT",
        f"/fields/{board.f['Due date']}/access/{board.user('member')}",
        json={"access": "hidden"},
    )
    assert hidden.status_code == 200, hidden.text
    summary = {r["Item"]: r["Value"] for r in table(await book(board, "member"), "Summary")}
    assert summary["Overdue"] == export.HIDDEN
    assert summary["Due today"] == export.HIDDEN
    assert summary["Open"] == 1


async def test_somebody_with_no_way_into_the_table_gets_no_file(board: Board) -> None:
    await board.create(Name="Not theirs", Assignee=[board.user("member")])
    assert_problem(await fetch(board, "member2"), 403)


async def test_another_company_does_not_know_the_table_exists(board: Board) -> None:
    assert_problem(await fetch(board, "other_admin"), 404)


async def test_a_file_needs_a_login_and_a_table(board: Board) -> None:
    anonymous = await board.work.client.get("/api/v1/reports/export", params={"table_id": board.id})
    assert anonymous.status_code == 401
    missing = await board.work.api("GET", "/reports/export", "admin")
    assert missing.status_code == 422
