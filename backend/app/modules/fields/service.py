import uuid
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ProblemError
from app.modules.bases.models import Table
from app.modules.fields import conversion, repository
from app.modules.fields.access import column_access
from app.modules.fields.models import (
    Field,
    FieldAccess,
    FieldAccessLevel,
    FieldSemantic,
    FieldType,
)
from app.modules.fields.schemas import (
    FieldAccessPublic,
    FieldAccessSet,
    FieldCreate,
    FieldPublic,
    FieldUpdate,
)
from app.modules.fields.types import (
    FieldConfigError,
    check_semantic,
    normalize_config,
)
from app.modules.permissions.service import (
    TableContext,
    load_table_context,
    require_table_read,
    require_table_role,
)
from app.modules.records import repository as records
from app.modules.records import visibility
from app.modules.users import repository as users
from app.modules.users.models import User, UserStatus
from app.modules.workspaces.models import WorkspaceRole

DUPLICATE_NAME = "A field with this name already exists in the table."
TOO_MANY_FIELDS = f"A table can have at most {repository.MAX_FIELDS_PER_TABLE} fields."


def public(field: Field, access: FieldAccessLevel) -> FieldPublic:
    return FieldPublic(
        id=field.id,
        table_id=field.table_id,
        name=field.name,
        type=field.type,
        config=field.config,
        semantic=field.semantic,
        grants_view=field.grants_view,
        is_required=field.is_required,
        position=field.position,
        access=access,
        created_at=field.created_at,
    )


def _invalid(message: str) -> ProblemError:
    return ProblemError(422, message)


async def visible_fields(
    session: AsyncSession, actor: User, context: TableContext
) -> list[tuple[Field, FieldAccessLevel]]:
    """The live columns of the table that the person may see, with their access level."""
    fields = await repository.list_fields(session, table_id=context.table.id)
    access = await column_access(session, actor, context, fields)
    return [
        (field, access[field.id]) for field in fields if access[field.id] != FieldAccessLevel.HIDDEN
    ]


async def list_fields(session: AsyncSession, actor: User, table_id: uuid.UUID) -> list[FieldPublic]:
    context = await require_table_read(session, actor, table_id)
    return [public(field, level) for field, level in await visible_fields(session, actor, context)]


async def _load_field(
    session: AsyncSession, actor: User, field_id: uuid.UUID, minimum: WorkspaceRole
) -> tuple[Field, TableContext]:
    """A field the person is allowed to know about. 404, then 403."""
    field = await repository.get_field(
        session, organization_id=actor.organization_id, field_id=field_id
    )
    if field is None:
        raise ProblemError(404, "The field does not exist.")
    if minimum == WorkspaceRole.VIEWER:
        context = await require_table_read(session, actor, field.table_id)
        access = await column_access(session, actor, context, [field])
        if access[field.id] == FieldAccessLevel.HIDDEN:
            # A hidden column must look like it does not exist.
            raise ProblemError(404, "The field does not exist.")
    else:
        context = await require_table_role(session, actor, field.table_id, minimum)
    return field, context


async def _free_name(session: AsyncSession, table_id: uuid.UUID, wanted: str) -> str:
    name, number = wanted[:190], 1
    candidate = name
    while await repository.name_taken(session, table_id=table_id, name=candidate):
        number += 1
        candidate = f"{name} {number}"
    return candidate


async def _insert(
    session: AsyncSession,
    table: Table,
    *,
    name: str,
    field_type: FieldType,
    config: dict[str, Any],
    semantic: FieldSemantic | None,
    grants_view: bool,
    is_required: bool,
) -> Field:
    field = Field(
        table_id=table.id,
        name=name,
        type=field_type,
        config=config,
        semantic=semantic,
        grants_view=grants_view,
        is_required=is_required,
        position=await repository.next_position(session, table_id=table.id),
    )
    session.add(field)
    try:
        await session.flush()
    except IntegrityError:  # the same name or role used at the same moment by another request
        raise ProblemError(409, DUPLICATE_NAME) from None
    return field


async def _insert_link_pair(
    session: AsyncSession,
    table: Table,
    target: Table,
    *,
    name: str,
    inverse_name: str | None,
    multiple: bool,
    semantic: FieldSemantic | None,
    grants_view: bool,
    is_required: bool,
) -> Field:
    """A link field and its mirror on the other table. Both are made together (docs/erd.md 3.5)."""
    inverse_semantic = (
        {
            FieldSemantic.PARENT: FieldSemantic.SUBTASKS,
            FieldSemantic.SUBTASKS: FieldSemantic.PARENT,
        }.get(semantic)
        if semantic
        else None
    )
    # A task has one parent and many subtasks.
    if semantic == FieldSemantic.PARENT:
        multiple, inverse_multiple = False, True
    elif semantic == FieldSemantic.SUBTASKS:
        multiple, inverse_multiple = True, False
    else:
        inverse_multiple = True

    forward = await _insert(
        session,
        table,
        name=name,
        field_type=FieldType.LINK_RECORD,
        config={"table_id": str(target.id), "multiple": multiple},
        semantic=semantic,
        grants_view=grants_view,
        is_required=is_required,
    )
    wanted_inverse = inverse_name or (table.name if target.id != table.id else f"{name} (reverse)")
    inverse = await _insert(
        session,
        target,
        name=await _free_name(session, target.id, wanted_inverse),
        field_type=FieldType.LINK_RECORD,
        config={
            "table_id": str(table.id),
            "multiple": inverse_multiple,
            "inverse_field_id": str(forward.id),
        },
        semantic=inverse_semantic,
        grants_view=False,
        is_required=False,
    )
    forward.config = {**forward.config, "inverse_field_id": str(inverse.id)}
    await session.flush()
    return forward


async def create_field(
    session: AsyncSession, actor: User, table_id: uuid.UUID, data: FieldCreate
) -> FieldPublic:
    context = await require_table_role(session, actor, table_id, WorkspaceRole.EDITOR)
    table = context.table
    try:
        config = normalize_config(data.type, data.config)
        grants_view = check_semantic(data.type, data.semantic, data.grants_view)
    except FieldConfigError as exc:
        raise _invalid(str(exc)) from None

    if await repository.count_fields(session, table_id=table.id) >= repository.MAX_FIELDS_PER_TABLE:
        raise ProblemError(409, TOO_MANY_FIELDS)
    if await repository.name_taken(session, table_id=table.id, name=data.name):
        raise ProblemError(409, DUPLICATE_NAME)
    if data.type == FieldType.TIMER and data.is_required:
        raise _invalid("A timer cannot be required.")
    if data.semantic is not None:
        taken = [data.semantic]
        if data.semantic in (FieldSemantic.PARENT, FieldSemantic.SUBTASKS):
            taken = [FieldSemantic.PARENT, FieldSemantic.SUBTASKS]
        for semantic in taken:
            if await repository.semantic_taken(session, table_id=table.id, semantic=semantic):
                raise ProblemError(409, f"The table already has a '{semantic.value}' field.")
    if data.is_required and await records.count_live(session, table_id=table.id) > 0:
        raise ProblemError(
            409, "A required field cannot be added to a table that already has records."
        )

    if data.type == FieldType.LINK_RECORD:
        target_id = uuid.UUID(config["table_id"])
        target_context = await load_table_context(session, actor, target_id)
        if target_context.role is None or not target_context.can_edit:
            raise ProblemError(403, "You do not have permission to link to that table.")
        if target_context.table.base_id != table.base_id:
            raise _invalid("A link can only join two tables of the same base.")
        if (
            data.semantic in (FieldSemantic.PARENT, FieldSemantic.SUBTASKS)
            and target_id != table.id
        ):
            raise _invalid("Parent and subtasks fields must link a table to itself.")
        if repository.MAX_FIELDS_PER_TABLE <= await repository.count_fields(
            session, table_id=target_id
        ):
            raise ProblemError(409, TOO_MANY_FIELDS)
        field = await _insert_link_pair(
            session,
            table,
            target_context.table,
            name=data.name,
            inverse_name=data.inverse_name,
            multiple=bool(config["multiple"]),
            semantic=data.semantic,
            grants_view=grants_view,
            is_required=data.is_required,
        )
    else:
        field = await _insert(
            session,
            table,
            name=data.name,
            field_type=data.type,
            config=config,
            semantic=data.semantic,
            grants_view=grants_view,
            is_required=data.is_required,
        )
        if data.type == FieldType.AUTO_NUMBER:
            await records.backfill_auto_number(session, field=field)
    return public(field, FieldAccessLevel.EDIT)


async def create_template_fields(session: AsyncSession, table: Table, template: str) -> None:
    """The columns of a new table. No permission check: the caller already checked the table."""
    await _insert(
        session,
        table,
        name="Name",
        field_type=FieldType.TEXT,
        config={},
        semantic=None,
        grants_view=False,
        is_required=False,
    )
    if template != "tasks":
        return
    await _insert(
        session,
        table,
        name="Assignee",
        field_type=FieldType.USER,
        config={"multiple": True},
        semantic=FieldSemantic.ASSIGNEE,
        grants_view=True,
        is_required=False,
    )
    await _insert(
        session,
        table,
        name="Follower",
        field_type=FieldType.USER,
        config={"multiple": True},
        semantic=FieldSemantic.FOLLOWER,
        grants_view=True,
        is_required=False,
    )
    await _insert(
        session,
        table,
        name="Status",
        field_type=FieldType.STATUS,
        config=normalize_config(FieldType.STATUS, {}),
        semantic=FieldSemantic.STATUS,
        grants_view=False,
        is_required=False,
    )
    await _insert(
        session,
        table,
        name="Due date",
        field_type=FieldType.DATE,
        config={"include_time": False},
        semantic=FieldSemantic.DUE_DATE,
        grants_view=False,
        is_required=False,
    )
    await _insert(
        session,
        table,
        name="Priority",
        field_type=FieldType.SINGLE_SELECT,
        config=normalize_config(
            FieldType.SINGLE_SELECT,
            {"options": [{"name": "High"}, {"name": "Medium"}, {"name": "Low"}]},
        ),
        semantic=None,
        grants_view=False,
        is_required=False,
    )
    await add_timer_field(session, table)
    for name, semantic in (
        ("Progress update", None),
        ("Result", None),
        ("Manager feedback", FieldSemantic.FEEDBACK),
    ):
        await _insert(
            session,
            table,
            name=name,
            field_type=FieldType.LONG_TEXT,
            config={},
            semantic=semantic,
            grants_view=False,
            is_required=False,
        )
    await _insert_link_pair(
        session,
        table,
        table,
        name="Parent task",
        inverse_name="Subtasks",
        multiple=False,
        semantic=FieldSemantic.PARENT,
        grants_view=False,
        is_required=False,
    )


async def add_timer_field(session: AsyncSession, table: Table) -> None:
    """The task timer: one column that holds when it was started and when it was stopped."""
    await _insert(
        session,
        table,
        name="Timer",
        field_type=FieldType.TIMER,
        config={},
        semantic=None,
        grants_view=False,
        is_required=False,
    )


async def get_field(session: AsyncSession, actor: User, field_id: uuid.UUID) -> FieldPublic:
    field, context = await _load_field(session, actor, field_id, WorkspaceRole.VIEWER)
    access = await column_access(session, actor, context, [field])
    return public(field, access[field.id])


async def update_field(
    session: AsyncSession, actor: User, field_id: uuid.UUID, data: FieldUpdate
) -> FieldPublic:
    field, context = await _load_field(session, actor, field_id, WorkspaceRole.EDITOR)
    changes = data.model_fields_set
    if not changes:
        raise _invalid("Nothing to change.")

    if "name" in changes and data.name is not None and data.name != field.name:
        if await repository.name_taken(
            session, table_id=field.table_id, name=data.name, except_id=field.id
        ):
            raise ProblemError(409, DUPLICATE_NAME)
        field.name = data.name

    if "position" in changes and data.position is not None:
        if data.position < 0:
            raise _invalid("The position cannot be negative.")
        field.position = data.position

    if "is_required" in changes and data.is_required is not None:
        if data.is_required and not field.is_required:
            if field.type in (FieldType.LINK_RECORD,):
                raise _invalid("A link field cannot be required.")
            if field.type == FieldType.TIMER:
                raise _invalid("A timer cannot be required.")
            missing = await records.count_missing_value(session, field=field)
            if missing:
                raise ProblemError(
                    409,
                    f"{missing} record(s) have no value in this field, so it cannot be required.",
                )
        field.is_required = data.is_required

    if data.type is not None and data.type != field.type:
        await conversion.change_type(session, field, data.type, data.config)
    elif "config" in changes and data.config is not None:
        try:
            new_config = normalize_config(field.type, data.config, existing=field.config)
        except FieldConfigError as exc:
            raise _invalid(str(exc)) from None
        if field.type == FieldType.LINK_RECORD and new_config != {**field.config}:
            raise _invalid("The target of a link cannot be changed. Make a new field instead.")
        await conversion.check_removed_options(session, field, new_config)
        field.config = new_config

    if "semantic" in changes:
        if await _change_role(session, field, data.semantic):
            # Rebuilding the viewers expires everything the session holds; reload what the
            # answer below is built from.
            for item in (field, actor, context.table, context.base, context.workspace):
                await session.refresh(item)

    try:
        await session.flush()
    except IntegrityError:
        raise ProblemError(409, DUPLICATE_NAME) from None
    access = await column_access(session, actor, context, [field])
    return public(field, access[field.id])


_LINK_ROLES = (FieldSemantic.PARENT, FieldSemantic.SUBTASKS)


async def _change_role(session: AsyncSession, field: Field, semantic: FieldSemantic | None) -> bool:
    """Give a column a role, or take it away (a People column made without one stays useless).

    The assignee and follower roles also let the people named in the column open the record, so
    the table's viewers are rebuilt when that changes (ADR 0003). Tasks that already name
    somebody are found by "My tasks" at once; no notification is sent for them afterwards.
    Returns True when the viewers were rebuilt.
    """
    if semantic == field.semantic:
        return False
    if field.semantic in _LINK_ROLES or semantic in _LINK_ROLES:
        raise _invalid(
            "The parent and subtasks roles belong to link columns and cannot be changed."
        )
    if semantic is None:
        grants_view = False
    else:
        try:
            grants_view = check_semantic(field.type, semantic, None)
        except FieldConfigError as exc:
            raise _invalid(str(exc)) from None
        if await repository.semantic_taken(session, table_id=field.table_id, semantic=semantic):
            raise ProblemError(409, f"The table already has a '{semantic.value}' field.")
    rebuild = grants_view != field.grants_view
    field.semantic = semantic
    field.grants_view = grants_view
    await session.flush()
    if rebuild:
        live = await repository.list_fields(session, table_id=field.table_id)
        await visibility.rebuild_table(session, field.table_id, live)
    return rebuild


async def delete_field(session: AsyncSession, actor: User, field_id: uuid.UUID) -> None:
    """Soft delete. The values stay in the records, so the column can be brought back."""
    field, _ = await _load_field(session, actor, field_id, WorkspaceRole.EDITOR)
    repository.soft_delete(field)
    inverse_id = (
        field.config.get("inverse_field_id") if field.type == FieldType.LINK_RECORD else None
    )
    if inverse_id:
        inverse = await session.get(Field, uuid.UUID(str(inverse_id)))
        if inverse is not None and inverse.deleted_at is None:
            repository.soft_delete(inverse)
    await session.flush()
    if field.grants_view:
        # The people named in this column no longer see the records because of it (ADR 0003).
        live = await repository.list_fields(session, table_id=field.table_id)
        await visibility.rebuild_table(session, field.table_id, live)


# --- column access ---------------------------------------------------------------------------


async def set_access(
    session: AsyncSession,
    actor: User,
    field_id: uuid.UUID,
    user_id: uuid.UUID,
    data: FieldAccessSet,
) -> FieldAccessPublic:
    """Hide a column from a person, make it read-only, or let them edit it."""
    field, _ = await _load_field(session, actor, field_id, WorkspaceRole.ADMIN)
    target = await users.get_in_organization(
        session, organization_id=actor.organization_id, user_id=user_id
    )
    if target is None or target.status != UserStatus.ACTIVE:
        raise _invalid("The employee does not exist or is disabled.")
    row = await session.get(FieldAccess, (field.id, user_id))
    if row is None:
        session.add(FieldAccess(field_id=field.id, user_id=user_id, access=data.access))
    else:
        row.access = data.access
    await session.flush()
    return FieldAccessPublic(field_id=field.id, user_id=user_id, access=data.access)


async def remove_access(
    session: AsyncSession, actor: User, field_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    field, _ = await _load_field(session, actor, field_id, WorkspaceRole.ADMIN)
    row = await session.get(FieldAccess, (field.id, user_id))
    if row is None:
        raise ProblemError(404, "This employee has no special access to the field.")
    await session.delete(row)
    await session.flush()


async def list_access(
    session: AsyncSession, actor: User, field_id: uuid.UUID
) -> list[FieldAccessPublic]:
    field, _ = await _load_field(session, actor, field_id, WorkspaceRole.ADMIN)
    rows = await repository.list_access(session, field_id=field.id)
    return [
        FieldAccessPublic(field_id=r.field_id, user_id=r.user_id, access=r.access) for r in rows
    ]
