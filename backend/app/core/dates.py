from datetime import UTC, date, datetime

from app.core.errors import ProblemError


def day_or_today(value: str | None) -> str:
    """The day for "today": the client sends its own date, because the server cannot know it."""
    if value is None:
        return datetime.now(UTC).date().isoformat()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ProblemError(422, "The date must look like 2026-11-13.") from None
