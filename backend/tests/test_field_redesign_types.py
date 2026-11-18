"""The field redesign without a database: the descriptor table, formats, limits, colors and the
shared properties (docs: the "Field redesign" proposal)."""

from typing import Any

import pytest

from app.modules.fields.models import FieldType
from app.modules.fields.types import (
    COMPUTED_TYPES,
    SPECS,
    STORED_IN_DATA,
    FieldConfigError,
    check_properties,
    normalize_config,
    normalize_default,
)

OPTIONS = {"options": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]}


def test_every_type_has_one_descriptor() -> None:
    assert set(SPECS) == set(FieldType)
    assert STORED_IN_DATA.isdisjoint({FieldType.LINK_RECORD, FieldType.CREATED_BY})
    assert COMPUTED_TYPES == {
        FieldType.CREATED_BY,
        FieldType.CREATED_TIME,
        FieldType.AUTO_NUMBER,
        FieldType.ATTACHMENT,
        FieldType.TIMER,
    }


def test_the_old_types_are_gone() -> None:
    assert {t.value for t in FieldType}.isdisjoint({"single_select", "multi_select", "url"})
    assert len(FieldType) == 14


@pytest.mark.parametrize(
    "field_type",
    [
        FieldType.CHECKBOX,
        FieldType.LINK_RECORD,
        FieldType.ATTACHMENT,
        FieldType.TIMER,
        FieldType.AUTO_NUMBER,
        FieldType.CREATED_TIME,
    ],
)
def test_these_types_cannot_be_required(field_type: FieldType) -> None:
    with pytest.raises(FieldConfigError):
        check_properties(field_type, is_required=True, is_unique=False, description=None)


@pytest.mark.parametrize(
    "field_type", [FieldType.LONG_TEXT, FieldType.DATE, FieldType.SELECT, FieldType.USER]
)
def test_these_types_cannot_be_unique(field_type: FieldType) -> None:
    with pytest.raises(FieldConfigError):
        check_properties(field_type, is_required=False, is_unique=True, description=None)


def test_text_and_number_can_be_unique() -> None:
    for field_type in (FieldType.TEXT, FieldType.NUMBER):
        check_properties(field_type, is_required=True, is_unique=True, description="hint")


def test_description_is_limited() -> None:
    with pytest.raises(FieldConfigError):
        check_properties(FieldType.TEXT, is_required=False, is_unique=False, description="x" * 501)
    with pytest.raises(FieldConfigError):
        check_properties(FieldType.TEXT, is_required=False, is_unique=False, description="a\x00b")


def test_text_config_stores_only_what_differs_from_the_default() -> None:
    assert normalize_config(FieldType.TEXT, {}) == {}
    assert normalize_config(FieldType.TEXT, {"format": "plain", "max_length": 1000}) == {}
    assert normalize_config(FieldType.TEXT, {"format": "email", "max_length": 80}) == {
        "format": "email",
        "max_length": 80,
    }
    assert normalize_config(FieldType.LONG_TEXT, {"max_length": 50000}) == {}
    assert normalize_config(FieldType.LONG_TEXT, {"max_length": 200}) == {"max_length": 200}


@pytest.mark.parametrize(
    ("field_type", "config"),
    [
        (FieldType.TEXT, {"format": "fax"}),
        (FieldType.TEXT, {"max_length": 0}),
        (FieldType.TEXT, {"max_length": 2049}),
        (FieldType.TEXT, {"max_length": True}),
        (FieldType.LONG_TEXT, {"max_length": 50001}),
        (FieldType.NUMBER, {"min": 5, "max": 1}),
        (FieldType.NUMBER, {"min": "a"}),
        (FieldType.NUMBER, {"min": True}),
        (FieldType.NUMBER, {"max": float("inf")}),
        (FieldType.NUMBER, {"format": "euro"}),
        (FieldType.NUMBER, {"currency": "USD"}),
        (FieldType.NUMBER, {"format": "currency", "currency": "dong"}),
        (FieldType.DATE, {"fill": "created"}),
        (FieldType.SELECT, {"multiple": "yes", "options": []}),
        (FieldType.STATUS, {"multiple": True, "options": []}),
        (FieldType.ATTACHMENT, {"max_files": 21}),
        (FieldType.ATTACHMENT, {"max_files": 0}),
        (FieldType.ATTACHMENT, {"accept": "pdf"}),
        (FieldType.ATTACHMENT, {"accept": ["pdf"]}),
        (FieldType.ATTACHMENT, {"accept": ["*/*;x"]}),
    ],
)
def test_new_invalid_configs_are_rejected(field_type: FieldType, config: dict[str, Any]) -> None:
    with pytest.raises(FieldConfigError):
        normalize_config(field_type, config)


def test_number_config_with_limits_format_and_currency() -> None:
    assert normalize_config(FieldType.NUMBER, {}) == {"precision": 0}
    assert normalize_config(
        FieldType.NUMBER, {"precision": 1, "min": 0, "max": 100, "format": "percent"}
    ) == {"precision": 1, "min": 0, "max": 100, "format": "percent"}
    assert normalize_config(FieldType.NUMBER, {"format": "currency"}) == {
        "precision": 0,
        "format": "currency",
        "currency": "VND",
    }


def test_attachment_config() -> None:
    assert normalize_config(FieldType.ATTACHMENT, {}) == {}
    assert normalize_config(
        FieldType.ATTACHMENT, {"max_files": 3, "accept": [".PDF", "image/*", ".pdf"]}
    ) == {"max_files": 3, "accept": [".pdf", "image/*"]}


def test_select_is_single_unless_multiple_and_keeps_its_choice_when_edited() -> None:
    first = normalize_config(FieldType.SELECT, {"options": [{"name": "A"}]})
    assert first["multiple"] is False
    second = normalize_config(FieldType.SELECT, {"multiple": True}, existing=first)
    assert second["multiple"] is True
    assert second["options"] == first["options"]
    third = normalize_config(FieldType.SELECT, {"options": first["options"]}, existing=second)
    assert third["multiple"] is True


def test_options_get_a_color_and_a_given_color_is_kept() -> None:
    config = normalize_config(
        FieldType.SELECT,
        {
            "options": [
                {"name": "A"},
                {"name": "B", "color": "#ABCDEF"},
                {"name": "C", "color": "red"},
            ]
        },
    )
    colors = [o["color"] for o in config["options"]]
    assert colors[0] == "#e5484d"  # the first color of the palette
    assert colors[1] == "#abcdef"  # hex is lower-cased
    assert colors[2] == "red"


def test_status_options_take_the_color_of_their_kind() -> None:
    config = normalize_config(FieldType.STATUS, {})
    by_kind = {o["kind"]: o["color"] for o in config["options"]}
    assert by_kind["done"] == "#46a758"
    assert by_kind["blocked"] == "#e5484d"
    assert len(set(by_kind.values())) == 6


def test_palette_wraps_around() -> None:
    config = normalize_config(FieldType.SELECT, {"options": [{"name": f"o{i}"} for i in range(13)]})
    assert config["options"][12]["color"] == config["options"][0]["color"]


def test_a_default_is_checked_like_a_cell() -> None:
    assert normalize_default(FieldType.TEXT, {}, None) is None
    assert normalize_default(FieldType.CHECKBOX, {}, False) is False
    assert normalize_default(FieldType.NUMBER, {"precision": 0, "max": 5}, 3) == 3
    with pytest.raises(FieldConfigError):
        normalize_default(FieldType.NUMBER, {"precision": 0, "max": 5}, 9)
    with pytest.raises(FieldConfigError):
        normalize_default(FieldType.USER, {"multiple": True}, [])  # people have no default
    with pytest.raises(FieldConfigError):
        normalize_default(FieldType.TIMER, {}, {})
