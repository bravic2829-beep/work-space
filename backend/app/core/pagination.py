import base64
import binascii

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
