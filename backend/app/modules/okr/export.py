"""Excel export of the same permission-filtered OKR data as the screen."""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment

from app.modules.okr.models import KrStatus
from app.modules.okr.schemas import ObjectivePublic, Overview
from app.modules.reports.export import write_table

STATUS = {
    KrStatus.ON_TRACK: "On track",
    KrStatus.AT_RISK: "At risk",
    KrStatus.OFF_TRACK: "Off track",
}


def _average_kr_score(objective: ObjectivePublic) -> float | None:
    scores = [kr.score for kr in objective.key_results if kr.score is not None]
    return sum(scores) / len(scores) if scores else None


def build(data: Overview) -> bytes:
    book = Workbook()
    summary = book.active
    assert summary is not None
    summary.title = "Summary"
    cycle = data.cycle
    write_table(
        summary,
        ["Item", "Value"],
        [
            ["Cycle", cycle.name],
            ["Starts", cycle.starts_on],
            ["Ends", cycle.ends_on],
            ["Status", cycle.status.value.title()],
            ["Objectives", data.summary.objectives],
            ["Key results", data.summary.key_results],
            ["Average progress", data.summary.progress],
            ["On track", data.summary.on_track],
            ["At risk", data.summary.at_risk],
            ["Off track", data.summary.off_track],
            ["Reviewed objectives", data.summary.reviewed],
        ],
    )
    summary["B8"].number_format = "0.0%"

    objectives = book.create_sheet("Objectives")
    parents = {objective.id: objective.title for objective in data.objectives}
    write_table(
        objectives,
        [
            "Objective",
            "Owner",
            "Level",
            "Department",
            "Supports",
            "Key results",
            "Total progress",
            "Average progress",
            "Score (0–1)",
            "Average KR score (0–1)",
            "Merits",
            "To improve",
        ],
        [
            [
                objective.title,
                objective.owner.full_name,
                objective.level.value.title(),
                objective.department.name if objective.department else None,
                parents.get(objective.parent_id) if objective.parent_id else None,
                len(objective.key_results),
                sum(kr.progress for kr in objective.key_results) if objective.key_results else None,
                objective.progress,
                objective.score,
                _average_kr_score(objective),
                objective.merits,
                objective.to_improve,
            ]
            for objective in data.objectives
        ],
    )

    key_results = book.create_sheet("Key results")
    write_table(
        key_results,
        [
            "Objective",
            "Key result",
            "Owner",
            "Status",
            "Progress",
            "Start",
            "Current",
            "Target",
            "Unit",
            "Score (0–1)",
            "Merits",
            "To improve",
            "Linked tasks",
        ],
        [
            [
                objective.title,
                kr.title,
                kr.owner.full_name,
                STATUS[kr.status],
                kr.progress,
                kr.start_value,
                kr.current_value,
                kr.target_value,
                kr.unit,
                kr.score,
                kr.merits,
                kr.to_improve,
                "\n".join(task.title or "Task name hidden" for task in kr.tasks) or None,
            ]
            for objective in data.objectives
            for kr in objective.key_results
        ],
    )

    for sheet, percentages, notes in (
        (objectives, (7, 8), (11, 12)),
        (key_results, (5,), (11, 12, 13)),
    ):
        sheet.auto_filter.ref = sheet.dimensions
        for row in range(2, sheet.max_row + 1):
            for column in percentages:
                sheet.cell(row, column).number_format = "0.0%"
            for column in notes:
                sheet.cell(row, column).alignment = Alignment(wrap_text=True, vertical="top")

    with BytesIO() as stream:
        book.save(stream)
        return stream.getvalue()
