"""Comments on records (docs/usecases.md 3.2: an assigned person can comment, not edit)."""

import uuid

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import FORBIDDEN, ProblemError
from app.core.pagination import Page, check_limit, parse_time_cursor, time_cursor
from app.modules.comments.models import Comment
from app.modules.comments.schemas import CommentAuthor, CommentCreate, CommentPublic
from app.modules.fields import repository as fields_repo
from app.modules.permissions.service import is_org_admin, role_at_least
from app.modules.records import service as records
from app.modules.sheets import access as sheet_access
from app.modules.sheets.models import SheetRole
from app.modules.users.models import User
from app.modules.workspaces.models import WorkspaceRole


def _public(comment: Comment, author: User) -> CommentPublic:
    return CommentPublic(
        id=comment.id,
        record_id=comment.record_id,
        author=CommentAuthor(id=author.id, full_name=author.full_name),
        body=comment.body,
        created_at=comment.created_at,
    )


async def list_comments(
    session: AsyncSession,
    actor: User,
    record_id: uuid.UUID,
    *,
    limit: int,
    cursor: str | None,
) -> Page[CommentPublic]:
    """Oldest first, for a record the person may see (404, then 403)."""
    check_limit(limit)
    await records.load_record(session, actor, record_id)
    query = (
        select(Comment, User)
        .join(User, User.id == Comment.author_id)
        .where(Comment.record_id == record_id)
        .order_by(Comment.created_at, Comment.id)
        .limit(limit + 1)
    )
    after = parse_time_cursor(cursor)
    if after is not None:
        query = query.where(tuple_(Comment.created_at, Comment.id) > tuple_(*after))
    rows = [(row[0], row[1]) for row in (await session.execute(query)).all()]
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if more:
        last = rows[-1][0]
        next_cursor = time_cursor(last.created_at, last.id)
    return Page[CommentPublic](items=[_public(c, a) for c, a in rows], next_cursor=next_cursor)


async def create_comment(
    session: AsyncSession, actor: User, record_id: uuid.UUID, data: CommentCreate
) -> CommentPublic:
    """Anyone who sees the record can comment, except a workspace viewer (read only).

    Somebody outside the workspace who sees the record because it was given to them (or
    created by them) can comment: that is the point of assigning work to them.
    """
    record, context = await records.load_record(session, actor, record_id)
    if context.role is not None and not role_at_least(context.role, WorkspaceRole.COMMENTER):
        raise ProblemError(403, FORBIDDEN)
    if context.role is None and record.created_by != actor.id:
        # Outside the workspace and seeing the task only through a sheet as a viewer: read only.
        columns = await fields_repo.list_fields(session, table_id=context.table.id)
        if actor.id not in sheet_access.owners_of(record, columns):
            if (
                await sheet_access.role_for_record(session, actor, record, columns)
                == SheetRole.VIEWER
            ):
                raise ProblemError(403, FORBIDDEN)
    if "\x00" in data.body:
        raise ProblemError(422, "The comment contains a character that is not allowed.")
    comment = Comment(record_id=record.id, author_id=actor.id, body=data.body)
    session.add(comment)
    await session.flush()
    await session.refresh(comment)
    return _public(comment, actor)


async def delete_comment(session: AsyncSession, actor: User, comment_id: uuid.UUID) -> None:
    """The author, or an organization admin, deletes a comment. Somebody who cannot see the
    record gets a 404."""
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise ProblemError(404, "The comment does not exist.")
    try:
        await records.load_record(session, actor, comment.record_id)
    except ProblemError:
        raise ProblemError(404, "The comment does not exist.") from None
    if comment.author_id != actor.id and not is_org_admin(actor):
        raise ProblemError(403, "Only the author, or an admin, can delete a comment.")
    await session.delete(comment)
    await session.flush()
