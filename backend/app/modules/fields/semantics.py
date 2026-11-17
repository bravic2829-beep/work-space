from collections.abc import Iterable

from app.modules.fields.models import Field, FieldSemantic


def by_semantic(fields: Iterable[Field], semantic: FieldSemantic) -> Field | None:
    """The column that plays this role in its table, if there is one."""
    return next((f for f in fields if f.semantic == semantic), None)
