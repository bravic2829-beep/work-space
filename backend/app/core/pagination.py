import base64
import binascii
import uuid
from datetime import UTC, datetime

from pydantic import BaseModel

from app.core.errors import ProblemError

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


class Page[T](BaseModel):
    """A page of results. `next_cursor` is null on the last page."""

    items: list[T]
    next_cursor: str | None


def encode_cursor(value: str) -> str:
    """Cursors are opaque to clients: they must send back exactly what they received."""
    return base64.urlsafe_b64encode(value.encode()).decode()


def decode_cursor(cursor: str) -> str:
    try:
        return base64.urlsafe_b64decode(cursor.encode()).decode()
    except (binascii.Error, UnicodeDecodeError, ValueError):
        raise ProblemError(422, "The cursor is not valid.") from None


def check_limit(limit: int) -> None:
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise ProblemError(422, f"The limit must be from 1 to {MAX_PAGE_SIZE}.")


def time_cursor(moment: datetime, row_id: uuid.UUID) -> str:
    """The cursor of a list ordered by a timestamp and then by id."""
    return encode_cursor(f"{moment.astimezone(UTC).isoformat()}|{row_id}")


def parse_time_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    """The (timestamp, id) a `time_cursor` holds. None when there is no cursor."""
    if cursor is None:
        return None
    try:
        stamp, raw_id = decode_cursor(cursor).split("|")
        parsed = datetime.fromisoformat(stamp)
        if parsed.tzinfo is None:
            raise ValueError("no time zone")
        return parsed, uuid.UUID(raw_id)
    except ValueError:
        raise ProblemError(422, "The cursor is not valid.") from None
