import enum

from sqlalchemy import Enum


def str_enum(enum_cls: type[enum.StrEnum], name: str) -> Enum:
    """A VARCHAR column limited by a CHECK constraint, not a native PostgreSQL ENUM.

    Adding a value later is a simple constraint change, while ALTER TYPE on a native enum is
    awkward to migrate and to roll back. The stored value is the enum's lowercase value.
    """
    return Enum(
        enum_cls,
        name=name,
        native_enum=False,
        length=32,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )
