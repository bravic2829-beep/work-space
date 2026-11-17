"""The Excel file of a report: the totals, the work per person and the list of tasks.

The file holds exactly what the caller may see on screen and nothing more:
- only the tasks they may open (the rule of the table itself),
- only the columns that are not hidden from them,
- a number that needs a hidden column is left out, as on the Reports page.

Every text is written as text, never as a formula: a task called `=HYPERLINK(...)` must not run
when somebody opens the file in Excel. The file is built in memory; a table with more than
`MAX_TASKS` tasks is cut there and the Summary sheet says so.
"""

import asyncio
import re
import unicodedata
import uuid
from datetime import datetime
from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fields.models import Field, FieldType
from app.modules.permissions.service import require_table_read
from app.modules.records import service as records
from app.modules.records.models import Record
from app.modules.reports import service
from app.modules.users.models import User

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_TASKS = 20_000
MAX_TEXT = 32_000  # an Excel cell holds at most 32,767 characters
HIDDEN = "—"

_HEADER_FONT = Font(bold=True)
_HEADER_FILL = PatternFill("solid", fgColor="E8EEF9")


def filename_for(table_name: str, day: str) -> str:
    """A plain ASCII file name: the table's name without accents ("report-Cong-viec-2026-11-17")."""
    folded = table_name.replace("đ", "d").replace("Đ", "D")
    ascii_name = unicodedata.normalize("NFKD", folded).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_name).strip("-")[:40] or "tasks"
    return f"report-{slug}-{day}.xlsx"


# --- turning a value of the table into a cell ----------------------------------------------------


def _names(ids: Any, people: dict[str, str]) -> str:
    if not isinstance(ids, list):
        return ""
    return ", ".join(people.get(str(i), "Unknown employee") for i in ids)


def _option_names(field: Field, chosen: Any) -> str:
    by_id = {o["id"]: o["name"] for o in field.config.get("options", [])}
    values = chosen if isinstance(chosen, list) else [chosen]
    return ", ".join(by_id.get(v, "") for v in values if v is not None and v in by_id)


def _hours(started: Any, finished: Any) -> float | None:
    try:
        begin = datetime.fromisoformat(str(started).replace("Z", "+00:00"))
        end = datetime.fromisoformat(str(finished).replace("Z", "+00:00"))
    except ValueError:
        return None
    return round(max(0.0, (end - begin).total_seconds()) / 3600, 2)


def _cells(field: Field, value: Any, people: dict[str, str]) -> list[Any]:
    """The cell(s) a column makes for one task. A timer makes three, every other column one."""
    kind = field.type
    if kind == FieldType.TIMER:
        cell = value if isinstance(value, dict) else {}
        started, finished = cell.get("started_at"), cell.get("finished_at")
        both = started and finished
        return [started or "", finished or "", _hours(started, finished) if both else ""]
    if value is None:
        return [""]
    if kind in (FieldType.NUMBER, FieldType.AUTO_NUMBER):
        return [value if isinstance(value, int | float) and not isinstance(value, bool) else ""]
    if kind == FieldType.CHECKBOX:
        return ["Yes" if value else "No"]
    if kind in (FieldType.SINGLE_SELECT, FieldType.MULTI_SELECT, FieldType.STATUS):
        return [_option_names(field, value)]
    if kind == FieldType.USER:
        return [_names(value, people)]
    if kind == FieldType.CREATED_BY:
        return [people.get(str(value), "Unknown employee")]
    if kind == FieldType.LINK_RECORD:
        count = len(value) if isinstance(value, list) else 0
        return [f"{count} linked" if count else ""]
    if kind == FieldType.ATTACHMENT:
        files = value if isinstance(value, list) else []
        return [", ".join(str(f.get("name", "")) for f in files if isinstance(f, dict))]
    return [value if isinstance(value, str) else str(value)]


def _headings(field: Field) -> list[str]:
    if field.type == FieldType.TIMER:
        return [f"{field.name}: started", f"{field.name}: finished", f"{field.name}: hours"]
    return [field.name]


# --- writing the workbook ----------------------------------------------------------------------


def _put(sheet: Worksheet, row: int, column: int, value: Any) -> None:
    """Write one cell. Text is always stored as text: `data_type = "s"` stops `=...` from being
    read as a formula, and characters XML cannot hold are dropped."""
    cell = sheet.cell(row=row, column=column)
    if isinstance(value, str):
        cell.value = ILLEGAL_CHARACTERS_RE.sub("", value)[:MAX_TEXT]
        cell.data_type = "s"
        cell.alignment = Alignment(wrap_text=False, vertical="top")
    else:
        cell.value = value
        cell.alignment = Alignment(vertical="top")


def _table(sheet: Worksheet, headings: list[str], rows: list[list[Any]]) -> None:
    for index, heading in enumerate(headings, start=1):
        _put(sheet, 1, index, heading)
        cell = sheet.cell(row=1, column=index)
        cell.font, cell.fill = _HEADER_FONT, _HEADER_FILL
    for number, values in enumerate(rows, start=2):
        for index, value in enumerate(values, start=1):
            _put(sheet, number, index, value)
    for index, heading in enumerate(headings, start=1):
        longest = max([len(heading)] + [len(str(r[index - 1])) for r in rows[:200]])
        sheet.column_dimensions[get_column_letter(index)].width = min(max(longest + 2, 10), 50)
    sheet.freeze_panes = "A2"


def _shown(value: int | None) -> int | str:
    return HIDDEN if value is None else value


def _workbook(
    summary: service.Overview,
    headings: list[str],
    task_rows: list[list[Any]],
    truncated: bool,
) -> bytes:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.title = "Summary"
    lines: list[list[Any]] = [
        ["Table", summary.table_name],
        ["Counted on", summary.day],
        ["Tasks counted", summary.total],
        ["Open", _shown(summary.open)],
        ["Overdue", _shown(summary.overdue)],
        ["Due today", _shown(summary.due_today)],
        ["Waiting for review", _shown(summary.in_review)],
        ["Blocked", _shown(summary.blocked)],
        ["Paused", _shown(summary.paused)],
        ["Done", _shown(summary.done)],
        ["Unassigned", _shown(summary.unassigned)],
    ]
    if truncated:
        lines.append(["Note", f"Only the first {MAX_TASKS} tasks are listed on the Tasks sheet."])
    _table(sheet, ["Item", "Value"], lines)
    sheet.freeze_panes = None
    sheet.column_dimensions["A"].width = 22
    sheet.column_dimensions["B"].width = 36

    if summary.by_status is not None:
        _table(
            book.create_sheet("By status"),
            ["Status", "Kind", "Tasks"],
            [[s.name, s.kind, s.count] for s in summary.by_status],
        )
    if summary.people is not None:
        _table(
            book.create_sheet("Work per person"),
            ["Employee", "Code", "Open", "Overdue", "Waiting for review", "Blocked", "Done"],
            [
                [p.full_name, p.employee_code, p.open, p.overdue, p.in_review, p.blocked, p.done]
                for p in summary.people
            ],
        )
    _table(book.create_sheet("Tasks"), headings, task_rows)

    out = BytesIO()
    book.save(out)
    return out.getvalue()


async def build(
    session: AsyncSession, actor: User, table_id: uuid.UUID, day: str | None
) -> tuple[bytes, str]:
    """The file and the name to save it under. Same permissions as the Reports page."""
    summary = await service.overview(session, actor, table_id, day)
    context = await require_table_read(session, actor, table_id)
    visible = records.visible_columns(await records.fields_with_access(session, actor, context))
    columns = [field for field, _ in visible]

    query = service.visible_records(actor, context, select(Record))
    found = list(
        (await session.execute(query.order_by(Record.created_at, Record.id).limit(MAX_TASKS + 1)))
        .scalars()
        .all()
    )
    truncated = len(found) > MAX_TASKS
    rendered = await records.render(session, actor, context, found[:MAX_TASKS], visible)

    # Every person named in a visible column, found with one query (in this organization only).
    wanted: set[uuid.UUID] = set()
    for record in rendered:
        for field in columns:
            value = record.data.get(str(field.id))
            if field.type == FieldType.USER and isinstance(value, list):
                wanted |= {uuid.UUID(str(i)) for i in value}
            elif field.type == FieldType.CREATED_BY and value:
                wanted.add(uuid.UUID(str(value)))
    people: dict[str, str] = {}
    if wanted:
        found_users = await session.execute(
            select(User.id, User.full_name, User.employee_code).where(
                User.id.in_(wanted), User.organization_id == actor.organization_id
            )
        )
        people = {str(i): f"{name} ({code})" for i, name, code in found_users.all()}

    headings = [h for field in columns for h in _headings(field)]
    task_rows = [
        [cell for field in columns for cell in _cells(field, r.data.get(str(field.id)), people)]
        for r in rendered
    ]
    content = await asyncio.to_thread(_workbook, summary, headings, task_rows, truncated)
    return content, filename_for(summary.table_name, summary.day)
