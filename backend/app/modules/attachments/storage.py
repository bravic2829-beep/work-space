"""Where the files are kept, and what is accepted.

Files go to `<attachments_dir>/<first two characters of the key>/<key>`. The key is random, so
nothing the client sends decides the path. A file is written under a temporary name and renamed
when it is complete, so a half-sent file is never visible.
"""

import asyncio
import mimetypes
import re
import unicodedata
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import unquote

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.errors import ProblemError

MAX_NAME_LENGTH = 200
MAX_FILES_PER_CELL = 20

# Documents, sheets, slides, pictures, text and archives. Anything that a browser or the system
# could run (html, svg, js, exe, bat, ps1, ...) is not on the list.
ALLOWED_EXTENSIONS = frozenset(
    {
        "pdf",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "xlsm",
        "csv",
        "ppt",
        "pptx",
        "txt",
        "md",
        "rtf",
        "odt",
        "ods",
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "zip",
        "7z",
        "rar",
    }
)

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_PENDING_KEY = "attachment_files_to_remove"


def clean_name(raw: str) -> str:
    """The name to keep: no folders, no control characters, a known extension. 422 otherwise."""
    name = unicodedata.normalize("NFC", unquote(raw)).replace("\\", "/").split("/")[-1]
    name = _CONTROL.sub("", name).strip().strip(".")
    stem, dot, extension = name.rpartition(".")
    if not dot or not stem.strip():
        raise ProblemError(422, "The file needs a name and an extension, like report.xlsx.")
    if len(name) > MAX_NAME_LENGTH:
        keep = MAX_NAME_LENGTH - len(extension) - 1
        name = f"{stem[:keep]}.{extension}"
    if extension.lower() not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise ProblemError(415, f"This kind of file is not accepted. Allowed: {allowed}.")
    return name


def content_type_of(name: str) -> str:
    return mimetypes.guess_type(name)[0] or "application/octet-stream"


def is_accepted(name: str, accept: list[str]) -> bool:
    """Does the file match one of the column's endings (.pdf) or types (image/*, image/png)?"""
    lowered = name.lower()
    kind = content_type_of(name)
    for entry in accept:
        if entry.startswith("."):
            if lowered.endswith(entry):
                return True
        elif entry.endswith("/*"):
            if kind.startswith(entry[:-1]):
                return True
        elif kind == entry:
            return True
    return False


def new_key() -> str:
    return uuid.uuid4().hex


def path_for(root: str, key: str) -> Path:
    return Path(root) / key[:2] / key


async def save(root: str, key: str, chunks: AsyncIterator[bytes], max_bytes: int) -> int:
    """Write the chunks to disk. Returns the size. 413 (and nothing kept) above `max_bytes`."""
    target = path_for(root, key)
    await asyncio.to_thread(target.parent.mkdir, parents=True, exist_ok=True)
    partial = target.with_suffix(".part")
    size = 0
    handle = await asyncio.to_thread(partial.open, "wb")
    try:
        async for chunk in chunks:
            size += len(chunk)
            if size > max_bytes:
                raise ProblemError(
                    413, f"The file is too big. The limit is {max_bytes // 1_000_000} MB."
                )
            await asyncio.to_thread(handle.write, chunk)
    except BaseException:
        await asyncio.to_thread(handle.close)
        await asyncio.to_thread(partial.unlink, True)
        raise
    await asyncio.to_thread(handle.close)
    if size == 0:
        await asyncio.to_thread(partial.unlink, True)
        raise ProblemError(422, "The file is empty.")
    await asyncio.to_thread(partial.replace, target)
    return size


def remove(root: str, key: str) -> None:
    """Delete a file if it is there (already gone is fine)."""
    path_for(root, key).unlink(missing_ok=True)


def remove_after_commit(session: Session, root: str, keys: list[str]) -> None:
    """Delete these files once the transaction has committed, so a rollback keeps them."""
    if keys:
        session.info.setdefault(_PENDING_KEY, []).extend((root, key) for key in keys)


@event.listens_for(Session, "after_commit")
def _remove_files(session: Session) -> None:
    pending: list[tuple[str, str]] = session.info.pop(_PENDING_KEY, [])
    for root, key in pending:
        try:
            remove(root, key)
        except OSError:  # a file that cannot be deleted must not fail a request that succeeded
            continue


@event.listens_for(Session, "after_rollback")
def _forget_files(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)
