"""What each field type means: its allowed config, and how a cell value is validated.

Pure functions, no database. Values that need the database (do these users exist, are these
records linkable) are checked by the records service after the shape is checked here.

Every type is declared once in `SPECS` (where its value lives, who may write it, which shared
properties apply). The sets other code uses (`COMPUTED_TYPES`, `STORED_IN_DATA`) come from it.

Stored value per type (in `records.data`, keyed by field id), see docs/erd.md section 3.3:
text, long_text: string. number: JSON number. date: ISO 8601 string. checkbox: boolean.
select: list of option ids (one or many, config.multiple). status: option id.
user: list of user ids.
link_record is stored in `record_links`; created_by, created_time are read from the record;
auto_number is an integer made when the record is created; attachment is read from the
`attachments` table (a list of {id, name, size, content_type}).
timer: {"started_at": ISO moment, "finished_at": ISO moment} (either may be missing), written only
by the timer endpoint.
"""

import enum
import math
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from app.modules.fields.models import FieldSemantic, FieldType

MAX_TEXT_LENGTH = 1000
MAX_TEXT_LENGTH_LIMIT = 2048  # the most a text column can be set to hold
MAX_LONG_TEXT_LENGTH = 50_000
MAX_OPTIONS = 100
MAX_OPTION_NAME_LENGTH = 100
MAX_USERS_PER_CELL = 50
MAX_LINKS_PER_CELL = 200
MAX_NUMBER_PRECISION = 10
MAX_ABS_NUMBER = 10**15
MAX_DESCRIPTION_LENGTH = 500
MAX_FILES_LIMIT = 20  # the same cap as attachments.storage.MAX_FILES_PER_CELL
MAX_ACCEPT_ENTRIES = 20

STATUS_KINDS = ("todo", "in_progress", "review", "done", "paused", "blocked")
DEFAULT_STATUS_OPTIONS = (
    ("To do", "todo"),
    ("In progress", "in_progress"),
    ("Pending review", "review"),
    ("Done", "done"),
    # On hold, or stuck on something outside the assignee's hands. Both are still open work.
    ("Paused", "paused"),
    ("Blocked", "blocked"),
)

# Colors of the options. A status option without a color takes the color of its kind; a select
# option takes the next color of the palette. The web page offers the same palette.
OPTION_PALETTE = (
    "#e5484d",
    "#f76808",
    "#f5a623",
    "#e5c100",
    "#46a758",
    "#12a594",
    "#0b9cd8",
    "#3e63dd",
    "#6e56cf",
    "#d6409f",
    "#8b97a3",
    "#3d4852",
)
STATUS_KIND_COLORS = {
    "todo": "#8b97a3",
    "in_progress": "#3e63dd",
    "review": "#f5a623",
    "done": "#46a758",
    "paused": "#6e56cf",
    "blocked": "#e5484d",
}


class Source(enum.StrEnum):
    """Where the value of a field lives."""

    DATA = "data"  # records.data
    RECORD = "record"  # a column of the record itself
    LINKS = "links"  # record_links
    ATTACHMENTS = "attachments"  # the attachments table


class Writer(enum.StrEnum):
    """Who can write the value."""

    PERSON = "person"  # through a record change
    SYSTEM = "system"  # made by the server
    ENDPOINT = "endpoint"  # only through its own endpoint


@dataclass(frozen=True)
class TypeSpec:
    source: Source
    writer: Writer
    required: bool  # the column can be marked required
    unique: bool  # no two records may share a value
    default: bool  # a value can be preset for new records


def _spec(
    source: Source,
    writer: Writer,
    *,
    required: bool = False,
    unique: bool = False,
    default: bool = False,
) -> TypeSpec:
    return TypeSpec(source, writer, required, unique, default)


_P, _S, _E = Writer.PERSON, Writer.SYSTEM, Writer.ENDPOINT
SPECS: dict[FieldType, TypeSpec] = {
    FieldType.TEXT: _spec(Source.DATA, _P, required=True, unique=True, default=True),
    FieldType.LONG_TEXT: _spec(Source.DATA, _P, required=True, default=True),
    FieldType.NUMBER: _spec(Source.DATA, _P, required=True, unique=True, default=True),
    FieldType.DATE: _spec(Source.DATA, _P, required=True, default=True),
    # False is a value, so "required" would mean nothing.
    FieldType.CHECKBOX: _spec(Source.DATA, _P, default=True),
    FieldType.SELECT: _spec(Source.DATA, _P, required=True, default=True),
    FieldType.STATUS: _spec(Source.DATA, _P, required=True),
    FieldType.USER: _spec(Source.DATA, _P, required=True),
    FieldType.LINK_RECORD: _spec(Source.LINKS, _P),
    FieldType.CREATED_BY: _spec(Source.RECORD, _S),
    FieldType.CREATED_TIME: _spec(Source.RECORD, _S),
    FieldType.AUTO_NUMBER: _spec(Source.DATA, _S),
    FieldType.ATTACHMENT: _spec(Source.ATTACHMENTS, _E),
    FieldType.TIMER: _spec(Source.DATA, _E),
}
assert set(SPECS) == set(FieldType), "every field type needs a TypeSpec"

SELECT_TYPES = frozenset({FieldType.SELECT, FieldType.STATUS})
# Values that are made by the system. Nobody can write them through a record change (files are
# added and removed through the attachment endpoints, which check the column's access; a timer
# only through its endpoint).
COMPUTED_TYPES = frozenset(t for t, spec in SPECS.items() if spec.writer != Writer.PERSON)
# Types whose values live in the record's JSONB `data`.
STORED_IN_DATA = frozenset(t for t, spec in SPECS.items() if spec.source == Source.DATA)

SEMANTIC_TYPES: dict[FieldSemantic, FieldType] = {
    FieldSemantic.ASSIGNEE: FieldType.USER,
    FieldSemantic.FOLLOWER: FieldType.USER,
    FieldSemantic.STATUS: FieldType.STATUS,
    FieldSemantic.DUE_DATE: FieldType.DATE,
    FieldSemantic.PARENT: FieldType.LINK_RECORD,
    FieldSemantic.SUBTASKS: FieldType.LINK_RECORD,
    FieldSemantic.FEEDBACK: FieldType.LONG_TEXT,
}

_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$|^[a-z]{3,20}$")


class FieldConfigError(ValueError):
    """The config of a field is not valid for its type."""


def _reject_unknown(config: dict[str, Any], allowed: set[str]) -> None:
    unknown = sorted(set(config) - allowed)
    if unknown:
        raise FieldConfigError(f"Unknown config key: {unknown[0]}.")


TEXT_FORMATS = ("plain", "url", "email", "phone")
NUMBER_FORMATS = ("plain", "percent", "currency")
DEFAULT_CURRENCY = "VND"
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_ACCEPT = re.compile(r"^(\.[a-z0-9]{1,10}|[a-z]+/(\*|[a-z0-9.+-]+))$")

# One pattern per text format. The same text is used by Python here and by PostgreSQL (`~*`) when
# a column is switched to a format and the existing values are checked.
FORMAT_PATTERNS = {
    "url": r"^https?://[^\s]+$",
    "email": r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    "phone": r"^\+?[0-9 ().-]{6,20}$",
}
_FORMAT_MESSAGES = {
    "url": "Must be a link starting with http:// or https://.",
    "email": "Must be an email address like name@example.com.",
    "phone": "Must be a phone number like +84 912 345 678.",
}


def _as_bool(config: dict[str, Any], key: str, default: bool) -> bool:
    value = config.get(key, default)
    if not isinstance(value, bool):
        raise FieldConfigError(f"{key} must be true or false.")
    return value


def _whole(config: dict[str, Any], key: str, low: int, high: int) -> int | None:
    value = config.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise FieldConfigError(f"{key} must be a whole number from {low} to {high}.")
    return value


def _bound(config: dict[str, Any], key: str) -> int | float | None:
    value = config.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise FieldConfigError(f"{key} must be a number.")
    if abs(value) > MAX_ABS_NUMBER:
        raise FieldConfigError(f"{key} must be a reasonable number.")
    return value


def text_limit(field_type: FieldType, config: dict[str, Any]) -> int:
    """The most characters a text or long text column holds."""
    default = MAX_LONG_TEXT_LENGTH if field_type == FieldType.LONG_TEXT else MAX_TEXT_LENGTH
    return int(config.get("max_length", default))


def text_format(config: dict[str, Any]) -> str:
    return str(config.get("format", "plain"))


def default_option_color(index: int, kind: str | None) -> str:
    if kind is not None:
        return STATUS_KIND_COLORS[kind]
    return OPTION_PALETTE[index % len(OPTION_PALETTE)]


def normalize_options(
    raw: Any, *, with_kind: bool, existing_ids: set[str] | None = None
) -> list[dict[str, str]]:
    """Check the option list of a select field and give every option an id and a color.

    An option that arrives with an id keeps it (renaming never touches the records). An option
    without an id gets a new one. A client cannot invent ids for new options, so a record can
    never point at an option it made up. An option without a color gets one: the color of its
    kind for a status, the next color of the palette for a select.
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
        kind: str | None = None
        if with_kind:
            kind = item.get("kind", "todo")
            if kind not in STATUS_KINDS:
                raise FieldConfigError(f"An option kind must be one of: {', '.join(STATUS_KINDS)}.")
        elif "kind" in item:
            raise FieldConfigError("Only a status field has option kinds.")
        color = item.get("color")
        if color is None:
            color = default_option_color(len(options), kind)
        elif not isinstance(color, str) or not _COLOR.match(color):
            raise FieldConfigError("An option color must be like #1a2b3c or a color name.")
        option["color"] = color.lower() if color.startswith("#") else color
        if kind is not None:
            option["kind"] = kind
        options.append(option)
    return options


def normalize_config(
    field_type: FieldType, config: dict[str, Any], *, existing: dict[str, Any] | None = None
) -> dict[str, Any]:
    """The cleaned config of a field, or FieldConfigError.

    `existing` is the current config when a field is edited: options keep their ids.
    """
    if field_type in SELECT_TYPES:
        allowed = {"options", "multiple"} if field_type == FieldType.SELECT else {"options"}
        _reject_unknown(config, allowed)
        with_kind = field_type == FieldType.STATUS
        if "options" not in config:
            if field_type == FieldType.STATUS and not existing:
                defaults = [{"name": n, "kind": k} for n, k in DEFAULT_STATUS_OPTIONS]
                config = {**config, "options": defaults}
            else:
                config = {**config, "options": (existing or {}).get("options", [])}
        known = {option["id"] for option in (existing or {}).get("options", [])}
        select: dict[str, Any] = {
            "options": normalize_options(config["options"], with_kind=with_kind, existing_ids=known)
        }
        if field_type == FieldType.SELECT:
            fallback = bool((existing or {}).get("multiple", False))
            select["multiple"] = _as_bool(config, "multiple", fallback)
        return select

    if field_type == FieldType.TEXT:
        _reject_unknown(config, {"format", "max_length"})
        text_fmt = config.get("format", "plain")
        if text_fmt not in TEXT_FORMATS:
            raise FieldConfigError(f"format must be one of: {', '.join(TEXT_FORMATS)}.")
        result: dict[str, Any] = {}
        if text_fmt != "plain":
            result["format"] = text_fmt
        limit = _whole(config, "max_length", 1, MAX_TEXT_LENGTH_LIMIT)
        if limit is not None and limit != MAX_TEXT_LENGTH:
            result["max_length"] = limit
        return result

    if field_type == FieldType.LONG_TEXT:
        _reject_unknown(config, {"max_length"})
        limit = _whole(config, "max_length", 1, MAX_LONG_TEXT_LENGTH)
        return {} if limit is None or limit == MAX_LONG_TEXT_LENGTH else {"max_length": limit}

    if field_type == FieldType.NUMBER:
        _reject_unknown(config, {"precision", "min", "max", "format", "currency"})
        precision = config.get("precision", 0)
        if (
            isinstance(precision, bool)
            or not isinstance(precision, int)
            or not 0 <= precision <= MAX_NUMBER_PRECISION
        ):
            raise FieldConfigError(
                f"precision must be a whole number from 0 to {MAX_NUMBER_PRECISION}."
            )
        number: dict[str, Any] = {"precision": precision}
        low, high = _bound(config, "min"), _bound(config, "max")
        if low is not None and high is not None and low > high:
            raise FieldConfigError("min cannot be more than max.")
        if low is not None:
            number["min"] = low
        if high is not None:
            number["max"] = high
        number_fmt = config.get("format", "plain")
        if number_fmt not in NUMBER_FORMATS:
            raise FieldConfigError(f"format must be one of: {', '.join(NUMBER_FORMATS)}.")
        if number_fmt != "currency" and "currency" in config:
            raise FieldConfigError("currency is only for the currency format.")
        if number_fmt != "plain":
            number["format"] = number_fmt
        if number_fmt == "currency":
            code = config.get("currency", DEFAULT_CURRENCY)
            if not isinstance(code, str) or not _CURRENCY.match(code):
                raise FieldConfigError("currency must be a code like VND or USD.")
            number["currency"] = code
        return number

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
        linked: dict[str, Any] = {
            "table_id": str(parsed),
            "multiple": _as_bool(config, "multiple", True),
        }
        if existing and "inverse_field_id" in existing:
            linked["inverse_field_id"] = existing["inverse_field_id"]
        return linked

    if field_type == FieldType.ATTACHMENT:
        _reject_unknown(config, {"max_files", "accept"})
        files: dict[str, Any] = {}
        max_files = _whole(config, "max_files", 1, MAX_FILES_LIMIT)
        if max_files is not None:
            files["max_files"] = max_files
        accept = config.get("accept")
        if accept is not None:
            if (
                not isinstance(accept, list)
                or len(accept) > MAX_ACCEPT_ENTRIES
                or not all(isinstance(e, str) and _ACCEPT.match(e.lower()) for e in accept)
            ):
                raise FieldConfigError(
                    "accept must be a list of file endings (.pdf) or types (image/*)."
                )
            if accept:
                files["accept"] = list(dict.fromkeys(e.lower() for e in accept))
        return files

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


def check_properties(
    field_type: FieldType, *, is_required: bool, is_unique: bool, description: str | None
) -> None:
    """The shared properties (required, unique, description) that a type does not allow."""
    spec = SPECS[field_type]
    if is_required and not spec.required:
        raise FieldConfigError(f"A {field_type.value} field cannot be required.")
    if is_unique and not spec.unique:
        raise FieldConfigError(f"A {field_type.value} field cannot be unique.")
    if description is not None:
        if "\x00" in description:
            raise FieldConfigError("The description cannot contain the NUL character.")
        if len(description) > MAX_DESCRIPTION_LENGTH:
            raise FieldConfigError(
                f"The description is at most {MAX_DESCRIPTION_LENGTH} characters."
            )


def normalize_default(field_type: FieldType, config: dict[str, Any], value: Any) -> Any:
    """The cleaned preset value of a column, or FieldConfigError. `None` means no default."""
    if value is None:
        return None
    if not SPECS[field_type].default:
        raise FieldConfigError(f"A {field_type.value} field cannot have a default value.")
    try:
        return normalize_value(field_type, config, value)
    except ValueError as exc:
        raise FieldConfigError(f"The default value is not valid: {exc}") from None


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


def _formatted_text(value: Any, config: dict[str, Any]) -> str:
    cleaned = _text(value, text_limit(FieldType.TEXT, config))
    kind = text_format(config)
    if kind == "plain":
        return cleaned
    cleaned = cleaned.strip()
    # Only web links for url: javascript: and data: links would run in the browser when clicked.
    if not re.match(FORMAT_PATTERNS[kind], cleaned, re.IGNORECASE):
        raise ValueError(_FORMAT_MESSAGES[kind])
    return cleaned


def _number(value: Any, config: dict[str, Any]) -> int | float:
    precision = int(config.get("precision", 0))
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
    result: int | float
    if precision == 0:
        result = int(rounded)
    else:
        result = float(rounded)
        if math.isinf(result):
            raise ValueError("Must be a reasonable number.")
    low, high = config.get("min"), config.get("max")
    if low is not None and result < low:
        raise ValueError(f"Must be at least {low}.")
    if high is not None and result > high:
        raise ValueError(f"Must be at most {high}.")
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
        return _formatted_text(value, config)
    if field_type == FieldType.LONG_TEXT:
        return _text(value, text_limit(FieldType.LONG_TEXT, config))
    if field_type == FieldType.NUMBER:
        return _number(value, config)
    if field_type == FieldType.DATE:
        return _date(value, bool(config.get("include_time", False)))
    if field_type == FieldType.CHECKBOX:
        if not isinstance(value, bool):
            raise ValueError("Must be true or false.")
        return value
    if field_type == FieldType.STATUS:
        if not isinstance(value, str) or value not in option_ids(config):
            raise ValueError("Must be the id of one of the options.")
        return value
    if field_type == FieldType.SELECT:
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError("Must be a list of option ids.")
        unknown = [item for item in value if item not in option_ids(config)]
        if unknown:
            raise ValueError("Must only contain ids of the options.")
        chosen = list(dict.fromkeys(value))
        if len(chosen) > 1 and not config.get("multiple", False):
            raise ValueError("Only one option is allowed in this field.")
        return chosen
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
