"""The rules of each field type, without a database."""

from typing import Any

import pytest

from app.modules.fields.models import FieldSemantic, FieldType
from app.modules.fields.types import (
    FieldConfigError,
    check_semantic,
    normalize_config,
    normalize_value,
)

OPTIONS = {"options": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]}


@pytest.mark.parametrize(
    ("field_type", "config", "value", "expected"),
    [
        (FieldType.TEXT, {}, "hello", "hello"),
        (FieldType.TEXT, {}, "xin chào 你好", "xin chào 你好"),
        (FieldType.LONG_TEXT, {}, "a" * 5000, "a" * 5000),
        (FieldType.NUMBER, {"precision": 0}, 12, 12),
        (FieldType.NUMBER, {"precision": 0}, "12.6", 13),
        (FieldType.NUMBER, {"precision": 2}, 1.005, 1.01),
        (FieldType.NUMBER, {"precision": 0}, 2.5, 3),
        (FieldType.NUMBER, {"precision": 0}, -2.5, -3),
        (FieldType.NUMBER, {"precision": 2}, "3.14159", 3.14),
        (FieldType.DATE, {"include_time": False}, "2026-11-13", "2026-11-13"),
        (
            FieldType.DATE,
            {"include_time": True},
            "2026-11-13T09:00:00+07:00",
            "2026-11-13T02:00:00Z",
        ),
        (FieldType.CHECKBOX, {}, True, True),
        (FieldType.URL, {}, "https://example.com/a?b=1", "https://example.com/a?b=1"),
        (FieldType.SINGLE_SELECT, OPTIONS, "a", "a"),
        (FieldType.STATUS, OPTIONS, "b", "b"),
        (FieldType.MULTI_SELECT, OPTIONS, ["a", "b", "a"], ["a", "b"]),
        (
            FieldType.USER,
            {"multiple": True},
            ["3f2b8c1e-0000-4000-8000-000000000001"],
            ["3f2b8c1e-0000-4000-8000-000000000001"],
        ),
    ],
)
def test_valid_values(
    field_type: FieldType, config: dict[str, Any], value: Any, expected: Any
) -> None:
    assert normalize_value(field_type, config, value) == expected


@pytest.mark.parametrize(
    ("field_type", "config", "value"),
    [
        (FieldType.TEXT, {}, 5),
        (FieldType.TEXT, {}, "a" * 1001),
        (FieldType.LONG_TEXT, {}, ["x"]),
        (FieldType.NUMBER, {"precision": 0}, "abc"),
        (FieldType.NUMBER, {"precision": 0}, True),
        (FieldType.NUMBER, {"precision": 0}, "NaN"),
        (FieldType.NUMBER, {"precision": 0}, "Infinity"),
        (FieldType.NUMBER, {"precision": 0}, 10**16),
        (FieldType.DATE, {"include_time": False}, "13/11/2026"),
        (FieldType.DATE, {"include_time": False}, 20261113),
        (FieldType.DATE, {"include_time": True}, "2026-11-13T09:00:00"),
        (FieldType.DATE, {"include_time": True}, "2026-11-13"),
        (FieldType.CHECKBOX, {}, "yes"),
        (FieldType.CHECKBOX, {}, 1),
        (FieldType.URL, {}, "javascript:alert(1)"),
        (FieldType.URL, {}, "data:text/html,<script>"),
        (FieldType.URL, {}, "https://exa mple.com"),
        (FieldType.SINGLE_SELECT, OPTIONS, "zzz"),
        (FieldType.SINGLE_SELECT, OPTIONS, ["a"]),
        (FieldType.MULTI_SELECT, OPTIONS, ["a", "zzz"]),
        (FieldType.MULTI_SELECT, OPTIONS, "a"),
        (FieldType.USER, {"multiple": True}, "not-a-list"),
        (FieldType.USER, {"multiple": True}, ["not-a-uuid"]),
        (
            FieldType.USER,
            {"multiple": False},
            [
                "3f2b8c1e-0000-4000-8000-000000000001",
                "3f2b8c1e-0000-4000-8000-000000000002",
            ],
        ),
        (FieldType.CREATED_BY, {}, "x"),
        (FieldType.CREATED_TIME, {}, "2026-11-13"),
        (FieldType.AUTO_NUMBER, {}, 5),
    ],
)
def test_invalid_values_are_rejected(
    field_type: FieldType, config: dict[str, Any], value: Any
) -> None:
    with pytest.raises(ValueError):
        normalize_value(field_type, config, value)


def test_number_does_not_overflow_into_infinity() -> None:
    with pytest.raises(ValueError):
        normalize_value(FieldType.NUMBER, {"precision": 10}, "1e400")


def test_status_gets_default_options_with_kinds() -> None:
    config = normalize_config(FieldType.STATUS, {})
    assert [o["name"] for o in config["options"]] == [
        "To do",
        "In progress",
        "Pending review",
        "Done",
        "Paused",
        "Blocked",
    ]
    assert [o["kind"] for o in config["options"]] == [
        "todo",
        "in_progress",
        "review",
        "done",
        "paused",
        "blocked",
    ]
    assert len({o["id"] for o in config["options"]}) == 6


@pytest.mark.parametrize(
    ("field_type", "config"),
    [
        (FieldType.NUMBER, {"precision": 11}),
        (FieldType.NUMBER, {"precision": -1}),
        (FieldType.NUMBER, {"precision": "2"}),
        (FieldType.NUMBER, {"unknown": 1}),
        (FieldType.TEXT, {"anything": 1}),
        (FieldType.DATE, {"include_time": "yes"}),
        (FieldType.USER, {"multiple": 1}),
        (FieldType.SINGLE_SELECT, {"options": "nope"}),
        (FieldType.SINGLE_SELECT, {"options": [{"name": "A"}, {"name": "a"}]}),
        (FieldType.SINGLE_SELECT, {"options": [{"name": ""}]}),
        (FieldType.SINGLE_SELECT, {"options": [{"name": "A", "kind": "done"}]}),
        (FieldType.SINGLE_SELECT, {"options": [{"name": "A", "color": "red; x"}]}),
        (FieldType.SINGLE_SELECT, {"options": [{"id": "invented", "name": "A"}]}),
        (FieldType.SINGLE_SELECT, {"options": [{"name": "A"}] * 2}),
        (FieldType.STATUS, {"options": [{"name": "A", "kind": "finished"}]}),
        (FieldType.LINK_RECORD, {}),
        (FieldType.LINK_RECORD, {"table_id": "nope"}),
        (FieldType.CREATED_BY, {"x": 1}),
    ],
)
def test_invalid_configs_are_rejected(field_type: FieldType, config: dict[str, Any]) -> None:
    with pytest.raises(FieldConfigError):
        normalize_config(field_type, config)


def test_options_keep_their_id_when_renamed() -> None:
    first = normalize_config(FieldType.SINGLE_SELECT, {"options": [{"name": "Open"}]})
    option_id = first["options"][0]["id"]
    again = normalize_config(
        FieldType.SINGLE_SELECT,
        {"options": [{"id": option_id, "name": "Opened"}, {"name": "New"}]},
        existing=first,
    )
    assert again["options"][0] == {"id": option_id, "name": "Opened"}
    assert again["options"][1]["id"] != option_id


def test_too_many_options_are_rejected() -> None:
    with pytest.raises(FieldConfigError):
        normalize_config(
            FieldType.SINGLE_SELECT, {"options": [{"name": f"o{i}"} for i in range(101)]}
        )


@pytest.mark.parametrize(
    ("field_type", "semantic"),
    [
        (FieldType.TEXT, FieldSemantic.ASSIGNEE),
        (FieldType.USER, FieldSemantic.STATUS),
        (FieldType.DATE, FieldSemantic.ASSIGNEE),
        (FieldType.TEXT, FieldSemantic.PARENT),
    ],
)
def test_semantic_must_match_type(field_type: FieldType, semantic: FieldSemantic) -> None:
    with pytest.raises(FieldConfigError):
        check_semantic(field_type, semantic, None)


def test_grants_view_defaults_and_limits() -> None:
    assert check_semantic(FieldType.USER, FieldSemantic.ASSIGNEE, None) is True
    assert check_semantic(FieldType.USER, FieldSemantic.FOLLOWER, None) is True
    assert check_semantic(FieldType.USER, None, None) is False
    assert check_semantic(FieldType.USER, FieldSemantic.ASSIGNEE, False) is False
    assert check_semantic(FieldType.USER, None, True) is True
    with pytest.raises(FieldConfigError):
        check_semantic(FieldType.TEXT, None, True)
