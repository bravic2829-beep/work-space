"""What each field type means: its allowed config, and how a cell value is validated.

Pure functions, no database. Values that need the database (do these users exist, are these
records linkable) are checked by the records service after the shape is checked here.

Stored value per type (in `records.data`, keyed by field id), see docs/erd.md section 3.3:
text, long_text, url: string. number: JSON number. date: ISO 8601 string. checkbox: boolean.
single_select, status: option id. multi_select: list of option ids. user: list of user ids.
link_record is stored in `record_links`; created_by, created_time are read from the record;
auto_number is an integer made when the record is created.
"""

import math
import re
import uuid
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from app.modules.fields.models import FieldSemantic, FieldType

MAX_TEXT_LENGTH = 1000
MAX_LONG_TEXT_LENGTH = 50_000
MAX_URL_LENGTH = 2048
MAX_OPTIONS = 100
MAX_OPTION_NAME_LENGTH = 100
MAX_USERS_PER_CELL = 50
MAX_LINKS_PER_CELL = 200
MAX_NUMBER_PRECISION = 10
MAX_ABS_NUMBER = 10**15

STATUS_KINDS = ("todo", "in_progress", "review", "done")
DEFAULT_STATUS_OPTIONS = (
    ("To do", "todo"),
    ("In progress", "in_progress"),
    ("Pending review", "review"),
    ("Done", "done"),
)

SELECT_TYPES = frozenset({FieldType.SINGLE_SELECT, FieldType.MULTI_SELECT, FieldType.STATUS})
# Values that are made by the system. Nobody can write them.
COMPUTED_TYPES = frozenset({FieldType.CREATED_BY, FieldType.CREATED_TIME, FieldType.AUTO_NUMBER})
# Types whose values live in the record's JSONB `data`.
STORED_IN_DATA = frozenset(
    set(FieldType) - {FieldType.LINK_RECORD, FieldType.CREATED_BY, FieldType.CREATED_TIME}
)

SEMANTIC_TYPES: dict[FieldSemantic, FieldType] = {
    FieldSemantic.ASSIGNEE: FieldType.USER,
    FieldSemantic.FOLLOWER: FieldType.USER,
    FieldSemantic.STATUS: FieldType.STATUS,
    FieldSemantic.DUE_DATE: FieldType.DATE,
    FieldSemantic.PARENT: FieldType.LINK_RECORD,
    FieldSemantic.SUBTASKS: FieldType.LINK_RECORD,
}

_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$|^[a-z]{3,20}$")


class FieldConfigError(ValueError):
    """The config of a field is not valid for its type."""


def _reject_unknown(config: dict[str, Any], allowed: set[str]) -> None:
    unknown = sorted(set(config) - allowed)
    if unknown:
        raise FieldConfigError(f"Unknown config key: {unknown[0]}.")


def _as_bool(config: dict[str, Any], key: str, default: bool) -> bool:
    value = config.get(key, default)
    if not isinstance(value, bool):
        raise FieldConfigError(f"{key} must be true or false.")
    return value


def normalize_options(
    raw: Any, *, with_kind: bool, existing_ids: set[str] | None = None
) -> list[dict[str, str]]:
    """Check the option list of a select field and give every option an id.

    An option that arrives with an id keeps it (renaming never touches the records). An option
    without an id gets a new one. A client cannot invent ids for new options, so a record can
    never point at an option it made up.
    """
    if not isinstance(raw, list):
        raise FieldConfigError("options must be a list.")
    if len(raw) > MAX_OPTIONS:
        raise FieldConfigError(f"A field can have at most {MAX_OPTIONS} options.")
    known = existing_ids or set()
    options: list[dict[str, str]] = []
    seen_names: set[str] = set()
    seen_ids: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise FieldConfigError("Each option must be an object.")
        _reject_unknown(item, {"id", "name", "color", "kind"})
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            raise FieldConfigError("Each option needs a name.")
        name = name.strip()
        if "\x00" in name:
            raise FieldConfigError("An option name cannot contain the NUL character.")
        if len(name) > MAX_OPTION_NAME_LENGTH:
            raise FieldConfigError("An option name is too long.")
        if name.lower() in seen_names:
            raise FieldConfigError(f"The option name '{name}' is used twice.")
        seen_names.add(name.lower())

        option_id = item.get("id")
        if option_id is None:
            option_id = uuid.uuid4().hex
        elif not isinstance(option_id, str) or option_id not in known:
            raise FieldConfigError("An option id is unknown. Leave it out to add a new option.")
        if option_id in seen_ids:
            raise FieldConfigError("An option id is used twice.")
        seen_ids.add(option_id)

        option = {"id": option_id, "name": name}
        color = item.get("color")
        if color is not None:
            if not isinstance(color, str) or not _COLOR.match(color):
                raise FieldConfigError("An option color must be like #1a2b3c or a color name.")
            option["color"] = color
        if with_kind:
            kind = item.get("kind", "todo")
            if kind not in STATUS_KINDS:
                raise FieldConfigError(f"An option kind must be one of: {', '.join(STATUS_KINDS)}.")
            option["kind"] = kind
        elif "kind" in item:
            raise FieldConfigError("Only a status field has option kinds.")
        options.append(option)
    return options


def normalize_config(
    field_type: FieldType, config: dict[str, Any], *, existing: dict[str, Any] | None = None
) -> dict[str, Any]:
    """The cleaned config of a field, or FieldConfigError.

    `existing` is the current config when a field is edited: options keep their ids.
    """
    if field_type in SELECT_TYPES:
        _reject_unknown(config, {"options"})
        with_kind = field_type == FieldType.STATUS
        if "options" not in config:
            if field_type == FieldType.STATUS and not existing:
                config = {"options": [{"name": n, "kind": k} for n, k in DEFAULT_STATUS_OPTIONS]}
            else:
                config = {"options": (existing or {}).get("options", [])}
        known = {option["id"] for option in (existing or {}).get("options", [])}
        return {
            "options": normalize_options(config["options"], with_kind=with_kind, existing_ids=known)
        }

    if field_type == FieldType.NUMBER:
        _reject_unknown(config, {"precision"})
        precision = config.get("precision", 0)
        if (
            isinstance(precision, bool)
            or not isinstance(precision, int)
            or not 0 <= precision <= MAX_NUMBER_PRECISION
        ):
            raise FieldConfigError(
                f"precision must be a whole number from 0 to {MAX_NUMBER_PRECISION}."
            )
        return {"precision": precision}

    if field_type == FieldType.DATE:
        _reject_unknown(config, {"include_time"})
        return {"include_time": _as_bool(config, "include_time", False)}

    if field_type == FieldType.USER:
        _reject_unknown(config, {"multiple"})
        return {"multiple": _as_bool(config, "multiple", True)}

    if field_type == FieldType.LINK_RECORD:
        _reject_unknown(config, {"table_id", "multiple", "inverse_field_id"})
        table_id = config.get("table_id")
        try:
            parsed = uuid.UUID(str(table_id))
        except ValueError:
            raise FieldConfigError("table_id must be the id of the table to link to.") from None
        result: dict[str, Any] = {
            "table_id": str(parsed),
            "multiple": _as_bool(config, "multiple", True),
        }
        if existing and "inverse_field_id" in existing:
            result["inverse_field_id"] = existing["inverse_field_id"]
        return result

    _reject_unknown(config, set())
    return {}


def check_semantic(
    field_type: FieldType, semantic: FieldSemantic | None, grants_view: bool | None
) -> bool:
    """Validate semantic and grants_view for a type. Returns the effective grants_view."""
    if semantic is not None and SEMANTIC_TYPES[semantic] != field_type:
        raise FieldConfigError(
            f"The '{semantic.value}' role needs a field of type {SEMANTIC_TYPES[semantic].value}."
        )
    if grants_view and field_type != FieldType.USER:
        raise FieldConfigError("Only a user field can grant view access.")
    if grants_view is None:
        return semantic in (FieldSemantic.ASSIGNEE, FieldSemantic.FOLLOWER)
    return grants_view


# --- values ----------------------------------------------------------------------------------


def _text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError("Must be text.")
    if "\x00" in value:
        # PostgreSQL cannot store the NUL character in text or JSONB.
        raise ValueError("Text cannot contain the NUL character.")
    if len(value) > limit:
        raise ValueError(f"Must be at most {limit} characters.")
    return value


def _number(value: Any, precision: int) -> int | float:
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        raise ValueError("Must be a number.")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ValueError("Must be a number.") from None
    if not number.is_finite() or abs(number) > MAX_ABS_NUMBER:
        raise ValueError("Must be a reasonable number.")
    # Half up, like people round (the default of Decimal is half to even: 12.345 -> 12.34).
    rounded = number.quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP)
    if precision == 0:
        return int(rounded)
    result = float(rounded)
    if math.isinf(result):
        raise ValueError("Must be a reasonable number.")
    return result


def _date(value: Any, include_time: bool) -> str:
    if not isinstance(value, str):
        raise ValueError("Must be an ISO 8601 date.")
    text_value = value.strip()
    try:
        if include_time:
            parsed = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("The time needs a timezone, like 2026-11-13T09:00:00Z.")
            return parsed.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return date.fromisoformat(text_value).isoformat()
    except ValueError as exc:
        message = str(exc)
        if message.startswith("The time needs"):
            raise ValueError(message) from None
        shape = "YYYY-MM-DDTHH:MM:SSZ" if include_time else "YYYY-MM-DD"
        raise ValueError(f"Must be a date like {shape}.") from None


def _id_list(value: Any, *, limit: int, multiple: bool, what: str) -> list[str]:
    if not isinstance(value, list):
        raise ValueError(f"Must be a list of {what}.")
    if len(value) > limit:
        raise ValueError(f"Too many {what} (at most {limit}).")
    cleaned: list[str] = []
    for item in value:
        try:
            parsed = str(uuid.UUID(str(item)))
        except ValueError:
            raise ValueError(f"Must be a list of {what} ids.") from None
        if parsed not in cleaned:
            cleaned.append(parsed)
    if not multiple and len(cleaned) > 1:
        raise ValueError(f"Only one of {what} is allowed in this field.")
    return cleaned


def option_ids(config: dict[str, Any]) -> set[str]:
    return {option["id"] for option in config.get("options", [])}


def normalize_value(field_type: FieldType, config: dict[str, Any], value: Any) -> Any:
    """The cleaned value for one cell. Raises ValueError with a message for the client.

    `None` is not handled here: it means "clear the cell" and is dealt with by the caller.
    """
    if field_type in COMPUTED_TYPES:
        raise ValueError("This value is set by the system and cannot be edited.")
    if field_type == FieldType.TEXT:
        return _text(value, MAX_TEXT_LENGTH)
    if field_type == FieldType.LONG_TEXT:
        return _text(value, MAX_LONG_TEXT_LENGTH)
    if field_type == FieldType.URL:
        url = _text(value, MAX_URL_LENGTH).strip()
        # Only web links: javascript: and data: links would run in the browser when clicked.
        if not re.match(r"^https?://[^\s]+$", url, re.IGNORECASE):
            raise ValueError("Must be a link starting with http:// or https://.")
        return url
    if field_type == FieldType.NUMBER:
        return _number(value, int(config.get("precision", 0)))
    if field_type == FieldType.DATE:
        return _date(value, bool(config.get("include_time", False)))
    if field_type == FieldType.CHECKBOX:
        if not isinstance(value, bool):
            raise ValueError("Must be true or false.")
        return value
    if field_type in (FieldType.SINGLE_SELECT, FieldType.STATUS):
        if not isinstance(value, str) or value not in option_ids(config):
            raise ValueError("Must be the id of one of the options.")
        return value
    if field_type == FieldType.MULTI_SELECT:
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError("Must be a list of option ids.")
        unknown = [item for item in value if item not in option_ids(config)]
        if unknown:
            raise ValueError("Must only contain ids of the options.")
        return list(dict.fromkeys(value))
    if field_type == FieldType.USER:
        return _id_list(
            value,
            limit=MAX_USERS_PER_CELL,
            multiple=bool(config.get("multiple", True)),
            what="employees",
        )
    if field_type == FieldType.LINK_RECORD:
        return _id_list(
            value,
            limit=MAX_LINKS_PER_CELL,
            multiple=bool(config.get("multiple", True)),
            what="records",
        )
    raise ValueError("This field type cannot hold a value.")  # pragma: no cover
