"""The status column of a task: each option has a kind (todo, in_progress, review, done)."""

from app.core.errors import ProblemError
from app.modules.fields.models import Field


def kind_of(status: Field, option_id: str | None) -> str:
    """The kind of the current option. A task with no status yet counts as "todo"."""
    if option_id is None:
        return "todo"
    for option in status.config.get("options", []):
        if option["id"] == option_id:
            return str(option["kind"])
    return "todo"


def option_of_kind(status: Field, kind: str) -> str:
    for option in status.config.get("options", []):
        if option.get("kind") == kind:
            return str(option["id"])
    raise ProblemError(409, f"The status column has no option of kind '{kind}'.")
