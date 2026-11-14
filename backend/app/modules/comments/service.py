"""Comments on records (docs/usecases.md 3.2: an assigned person can comment, not edit)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.core.pagination import MAX_PAGE_SIZE, Page, decode_cursor, encode_cursor
from app.modules.comments.models import Comment
from app.modules.comments.schemas import CommentAuthor, CommentCreate, CommentPublic
from app.modules.permissions.service import role_at_least
from app.modules.records import service as records
from app.modules.users.models import User
from app.modules.workspaces.models import WorkspaceRole

FORBIDDEN = "You do not have permission to do this."


def _public(comment: Comment, author: User) -> CommentPublic:
    return CommentPublic(
        id=comment.id,
        record_id=comment.record_id,
        author=CommentAuthor(id=author.id, full_name=author.full_name),
        body=comment.body,
        created_at=comment.created_at,
    )


def _parse_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
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


async def list_comments(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    *,
    limit: int,
    cursor: str | None,
) -> Page[CommentPublic]:
    """Oldest first, for a record the person may see (404, then 403)."""
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise ProblemError(422, f"The limit must be from 1 to {MAX_PAGE_SIZE}.")
    await records._load(session, actor, record_id)
    query = (
        select(Comment, User)
        .join(User, User.id == Comment.author_id)
        .where(Comment.record_id == record_id)
        .order_by(Comment.created_at, Comment.id)
        .limit(limit + 1)
    )
    after = _parse_cursor(cursor)
    if after is not None:
        query = query.where(tuple_(Comment.created_at, Comment.id) > tuple_(*after))
    rows = [(row[0], row[1]) for row in (await session.execute(query)).all()]
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if more:
        last = rows[-1][0]
        next_cursor = encode_cursor(f"{last.created_at.astimezone(UTC).isoformat()}|{last.id}")
    return Page[CommentPublic](items=[_public(c, a) for c, a in rows], next_cursor=next_cursor)


async def create_comment(
    session: AsyncSession, actor: User, record_id: uuid.UUID, data: CommentCreate
) -> CommentPublic:
    """Anyone who sees the record can comment, except a workspace viewer (read only).

    Somebody outside the workspace who sees the record because it was given to them (or
    created by them) can comment: that is the point of assigning work to them.
    """
    record, context = await records._load(session, actor, record_id)
    if context.role is not None and not role_at_least(context.role, WorkspaceRole.COMMENTER):
        raise ProblemError(403, FORBIDDEN)
    if "\x00" in data.body:
        raise ProblemError(422, "The comment contains a character that is not allowed.")
    comment = Comment(record_id=record.id, author_id=actor.id, body=data.body)
    session.add(comment)
    await session.flush()
    await session.refresh(comment)
    return _public(comment, actor)


async def delete_comment(session: AsyncSession, actor: User, comment_id: uuid.UUID) -> None:
    """Only the author deletes a comment. Somebody who cannot see the record gets a 404."""
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise ProblemError(404, "The comment does not exist.")
    try:
        await records._load(session, actor, comment.record_id)
    except ProblemError:
        raise ProblemError(404, "The comment does not exist.") from None
    if comment.author_id != actor.id:
        raise ProblemError(403, "Only the author can delete a comment.")
    await session.delete(comment)
    await session.flush()
