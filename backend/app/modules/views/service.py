import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import flush_or_conflict
from app.core.errors import FORBIDDEN, ProblemError
from app.modules.fields import service as fields_service
from app.modules.permissions.service import require_table_read
from app.modules.records import listing
from app.modules.users.models import User
from app.modules.views.models import View
from app.modules.views.schemas import ViewConfig, ViewCreate, ViewPublic, ViewUpdate

MAX_VIEWS = 50
DUPLICATE = "You already have a view with this name on this table."


def _public(view: View) -> ViewPublic:
    return ViewPublic(
        id=view.id,
        table_id=view.table_id,
        name=view.name,
        config=view.config,
        created_at=view.created_at,
        updated_at=view.updated_at,
    )


async def _check_config(
    session: AsyncSession, actor: User, table_id: uuid.UUID, config: ViewConfig
) -> dict[str, Any]:
    """The config of a view may only name columns the owner can see, with real operators.

    The same parsers as the record list are used, so a saved view can never be something the
    list would refuse. Columns deleted or hidden later are tolerated when a view is read.
    """
    context = await require_table_read(session, actor, table_id)
    visible = await fields_service.visible_fields(session, actor, context)
    by_id = {str(field.id): field for field, _ in visible}
    clean: dict[str, Any] = config.model_dump(mode="json")
    listing.parse_filter(json.dumps(clean["filter"]), by_id)
    listing.parse_sort([f"{c['field']}:{c['direction']}" for c in clean["sort"]], by_id)
    if any(field_id not in by_id for field_id in clean["hidden_fields"]):
        raise ProblemError(
            422,
            "One or more values are invalid.",
            errors=[{"field": "config.hidden_fields", "message": "Unknown field."}],
        )
    return clean


async def list_views(session: AsyncSession, actor: User, table_id: uuid.UUID) -> list[ViewPublic]:
    await require_table_read(session, actor, table_id)
    rows = await session.execute(
        select(View)
        .where(View.table_id == table_id, View.owner_user_id == actor.id)
        .order_by(func.lower(View.name), View.id)
    )
    return [_public(view) for view in rows.scalars()]


async def create_view(
    session: AsyncSession, actor: User, table_id: uuid.UUID, data: ViewCreate
) -> ViewPublic:
    config = await _check_config(session, actor, table_id, data.config)
    count = (
        await session.execute(
            select(func.count())
            .select_from(View)
            .where(View.table_id == table_id, View.owner_user_id == actor.id)
        )
    ).scalar_one()
    if count >= MAX_VIEWS:
        raise ProblemError(409, f"You can have at most {MAX_VIEWS} views on a table.")
    view = View(table_id=table_id, owner_user_id=actor.id, name=data.name, config=config)
    session.add(view)
    await flush_or_conflict(session, DUPLICATE)
    return _public(view)


async def _own_view(session: AsyncSession, actor: User, view_id: uuid.UUID) -> View:
    """A view of the caller. 404 when it does not exist, 403 when it belongs to somebody else
    (views are private)."""
    view = await session.get(View, view_id)
    if view is None:
        raise ProblemError(404, "The view does not exist.")
    # The table must still be readable by the caller (this also checks the organization).
    await require_table_read(session, actor, view.table_id)
    if view.owner_user_id != actor.id:
        raise ProblemError(403, FORBIDDEN)
    return view


async def get_view(session: AsyncSession, actor: User, view_id: uuid.UUID) -> ViewPublic:
    return _public(await _own_view(session, actor, view_id))


async def update_view(
    session: AsyncSession, actor: User, view_id: uuid.UUID, data: ViewUpdate
) -> ViewPublic:
    view = await _own_view(session, actor, view_id)
    if not data.model_fields_set:
        raise ProblemError(422, "Nothing to change.")
    if data.config is not None:
        view.config = await _check_config(session, actor, view.table_id, data.config)
    if data.name is not None:
        view.name = data.name
    view.updated_at = datetime.now(UTC)
    await flush_or_conflict(session, DUPLICATE)
    return _public(view)


async def delete_view(session: AsyncSession, actor: User, view_id: uuid.UUID) -> None:
    view = await _own_view(session, actor, view_id)
    await session.delete(view)
    await session.flush()
