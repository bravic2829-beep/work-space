import { describe, expect, it } from "vitest";

import {
  ASSIGNEE,
  AUTHOR,
  CREATED,
  DONE,
  DUE,
  FIELDS,
  NAME,
  POINTS,
  PRIORITY,
  TAGS,
  makeField,
  makeRecord,
} from "./fixtures";
import {
  canEditField,
  changesFor,
  conditionValue,
  describeCondition,
  displayValue,
  emptyColumnIds,
  draftFromValue,
  formatNumber,
  isMultiple,
  isSortable,
  newRecordDraft,
  operatorsFor,
  parseDraft,
  userIdsIn,
} from "./values";

const names = new Map([["u-1", "Ann (A1)"]]);

describe("display", () => {
  it("shows each type the way people read it", () => {
    expect(displayValue(NAME, "Plan", names)).toBe("Plan");
    expect(displayValue(POINTS, 12, names)).toBe("12");
    expect(displayValue(DONE, true, names)).toBe("✓");
    expect(displayValue(DONE, false, names)).toBe("");
    expect(displayValue(PRIORITY, ["o-high"], names)).toBe("High");
    expect(displayValue(TAGS, ["o-x", "o-y"], names)).toBe("x, y");
    expect(displayValue(DUE, "2026-11-13", names)).toBe("2026-11-13");
    expect(displayValue(ASSIGNEE, ["u-1"], names)).toBe("Ann (A1)");
    expect(displayValue(AUTHOR, "u-1", names)).toBe("Ann (A1)");
  });

  it("shows an ellipsis while a name is still being fetched", () => {
    expect(displayValue(ASSIGNEE, ["u-9"], names)).toBe("…");
  });

  it("shows nothing for an empty cell and counts links", () => {
    expect(displayValue(NAME, undefined, names)).toBe("");
    expect(displayValue(NAME, null, names)).toBe("");
    const link = makeField("f-link", "Project", "link_record");
    expect(displayValue(link, ["a", "b"], names)).toBe("2 linked");
    expect(displayValue(link, [], names)).toBe("");
  });

  it("ignores an option id it does not know", () => {
    expect(displayValue(PRIORITY, "gone", names)).toBe("");
  });
});

describe("what can be edited and sorted", () => {
  it("computed columns are never editable", () => {
    expect(canEditField(CREATED)).toBe(false);
    expect(canEditField(AUTHOR)).toBe(false);
    expect(canEditField(makeField("f", "N", "auto_number"))).toBe(false);
  });

  it("only columns with edit access are editable", () => {
    expect(canEditField(NAME)).toBe(true);
    expect(canEditField({ ...NAME, access: "read" })).toBe(false);
  });

  it("some types have no order", () => {
    expect(isSortable(NAME)).toBe(true);
    expect(isSortable(POINTS)).toBe(true);
    expect(isSortable(PRIORITY)).toBe(true);
    expect(isSortable(TAGS)).toBe(true); // by its first option
    expect(isSortable(ASSIGNEE)).toBe(false);
  });
});

describe("drafts and values", () => {
  it("starts a draft from the stored value", () => {
    expect(draftFromValue(NAME, undefined)).toBe("");
    expect(draftFromValue(POINTS, 5)).toBe("5");
    expect(draftFromValue(DONE, true)).toBe(true);
    expect(draftFromValue(TAGS, ["o-x"])).toEqual(["o-x"]);
    expect(draftFromValue(ASSIGNEE, undefined)).toEqual([]);
  });

  it("turns numbers into numbers and rejects other text", () => {
    expect(parseDraft(POINTS, "12.5")).toEqual({ ok: true, value: 12.5 });
    expect(parseDraft(POINTS, "")).toEqual({ ok: true, value: null });
    expect(parseDraft(POINTS, "abc").ok).toBe(false);
    expect(parseDraft(POINTS, "1e999").ok).toBe(false);
  });

  it("sends empty text and an unset choice as a cleared cell", () => {
    expect(parseDraft(NAME, "")).toEqual({ ok: true, value: null });
    expect(parseDraft(PRIORITY, [])).toEqual({ ok: true, value: null });
    expect(parseDraft(PRIORITY, ["o-low"])).toEqual({ ok: true, value: ["o-low"] });
  });

  it("sends a date and time in UTC", () => {
    const withTime = makeField("f-at", "At", "date", { config: { include_time: true } });
    const parsed = parseDraft(withTime, "2026-11-13T09:00");
    expect(parsed.ok && typeof parsed.value === "string" && parsed.value.endsWith("Z")).toBe(true);
    expect(parseDraft(withTime, "garbage").ok).toBe(false);
    expect(parseDraft(DUE, "2026-11-13")).toEqual({ ok: true, value: "2026-11-13" });
  });
});

describe("what changed", () => {
  const record = makeRecord("r-1", { "f-name": "Plan", "f-points": 5, "f-tags": ["o-x"] });
  const unchanged = {
    "f-name": "Plan",
    "f-points": "5",
    "f-done": false,
    "f-tags": ["o-x"],
    "f-priority": [] as string[],
    "f-due": "",
    "f-assignee": [] as string[],
  };

  it("sends nothing when nothing changed", () => {
    expect(changesFor(FIELDS, record, unchanged)).toEqual({ changes: {}, errors: {} });
  });

  it("sends only the cells that changed", () => {
    const result = changesFor(FIELDS, record, { ...unchanged, "f-name": "Final", "f-done": true });
    expect(result.changes).toEqual({ "f-name": "Final", "f-done": true });
  });

  it("clears a cell with null", () => {
    const result = changesFor(FIELDS, record, { ...unchanged, "f-name": "", "f-tags": [] });
    expect(result.changes).toEqual({ "f-name": null, "f-tags": null });
  });

  it("does not treat an untouched empty cell as a change", () => {
    const empty = makeRecord("r-2", {});
    expect(changesFor(FIELDS, empty, unchanged).changes).toEqual({
      "f-name": "Plan",
      "f-points": 5,
      "f-tags": ["o-x"],
    });
    expect(changesFor(FIELDS, empty, { ...unchanged, "f-name": "", "f-points": "", "f-tags": [] }).changes).toEqual({});
  });

  it("sends only filled cells for a new record", () => {
    const drafts = { ...unchanged, "f-name": "New", "f-points": "", "f-tags": [] as string[] };
    expect(changesFor(FIELDS, null, drafts).changes).toEqual({ "f-name": "New" });
  });

  it("reports drafts that cannot be understood, by field", () => {
    const result = changesFor(FIELDS, record, { ...unchanged, "f-points": "lots" });
    expect(result.errors).toEqual({ "f-points": "Must be a number." });
    expect(result.changes["f-points"]).toBeUndefined();
  });

  it("never sends read-only or computed columns", () => {
    const readOnly = FIELDS.map((f) => (f.id === "f-name" ? { ...f, access: "read" as const } : f));
    const result = changesFor(readOnly, record, {
      ...unchanged,
      "f-name": "Hacked",
      "f-created": "2020-01-01",
    });
    expect(result.changes).toEqual({});
  });
});

describe("filters", () => {
  it("offers operators that fit the type", () => {
    expect(operatorsFor(NAME).map((o) => o.op)).toEqual(["eq", "neq", "contains", "is_empty", "is_not_empty"]);
    expect(operatorsFor(POINTS).map((o) => o.op)).toContain("gt");
    expect(operatorsFor(DONE).map((o) => o.op)).toEqual(["eq"]);
    expect(operatorsFor(TAGS).map((o) => o.op)).toEqual(["eq", "neq", "is_empty", "is_not_empty"]);
    expect(operatorsFor(TAGS)[0].label).toBe("includes");
    expect(operatorsFor(PRIORITY)[0].label).toBe("is");
  });

  it("people are only filtered by empty or not, and the creator not at all", () => {
    expect(operatorsFor(ASSIGNEE).map((o) => o.op)).toEqual(["is_empty", "is_not_empty"]);
    expect(operatorsFor(AUTHOR)).toEqual([]);
  });

  it("makes values of the right JSON type", () => {
    expect(conditionValue(POINTS, "10")).toBe(10);
    expect(conditionValue(DONE, "true")).toBe(true);
    expect(conditionValue(DONE, "false")).toBe(false);
    expect(conditionValue(NAME, "10")).toBe("10");
  });

  it("describes a condition in words", () => {
    expect(describeCondition(FIELDS, { field: "f-points", op: "gt", value: 5 })).toBe(
      "Points is after / greater than 5",
    );
    expect(describeCondition(FIELDS, { field: "f-priority", op: "eq", value: "o-high" })).toBe(
      "Priority is High",
    );
    expect(describeCondition(FIELDS, { field: "f-name", op: "is_empty" })).toBe("Name is empty");
    expect(describeCondition(FIELDS, { field: "gone", op: "eq", value: 1 })).toBe("Unknown column");
  });
});

describe("people in the records", () => {
  it("collects the ids of user fields and of the creator", () => {
    const records = [
      makeRecord("r-1", { "f-assignee": ["u-1", "u-2"], "f-author": "u-3" }),
      makeRecord("r-2", { "f-assignee": ["u-2"] }),
    ];
    expect(userIdsIn([ASSIGNEE, AUTHOR, NAME], records).sort()).toEqual(["u-1", "u-2", "u-3"]);
  });
});

describe("a value preset for new records", () => {
  const withDefault = makeField("f-d", "Source", "text", { default: "web" });
  const checked = makeField("f-c", "Paid", "checkbox", { default: true });
  const size = makeField("f-s", "Size", "select", {
    config: { multiple: false, options: [{ id: "o-m", name: "M" }] },
    default: ["o-m"],
  });
  const day = makeField("f-day", "Day", "date", { default: "2026-01-01" });
  const count = makeField("f-n", "Qty", "number", { default: 3 });

  it("is already in the form of a new record, as a draft that can be changed", () => {
    expect(newRecordDraft(withDefault)).toBe("web");
    expect(newRecordDraft(checked)).toBe(true);
    expect(newRecordDraft(size)).toEqual(["o-m"]);
    expect(newRecordDraft(day)).toBe("2026-01-01");
    expect(newRecordDraft(count)).toBe("3");
  });

  it("is nothing when the column has no default", () => {
    expect(newRecordDraft(NAME)).toBe("");
    expect(newRecordDraft(DUE)).toBe("");
    expect(newRecordDraft(TAGS)).toEqual([]);
  });

  it("is sent when the record is saved", () => {
    const drafts = { [withDefault.id]: newRecordDraft(withDefault), [size.id]: newRecordDraft(size) };
    const { changes } = changesFor([withDefault, size], null, drafts);
    expect(changes).toEqual({ "f-d": "web", "f-s": ["o-m"] });
  });
});

describe("numbers and text with a format", () => {
  it("shows a number as plain, percent or money", () => {
    expect(formatNumber(POINTS, 12)).toBe("12");
    const pct = makeField("f-p", "Done", "number", { config: { precision: 1, format: "percent" } });
    expect(formatNumber(pct, 12.5)).toBe("12.5%");
    const money = makeField("f-m", "Price", "number", {
      config: { precision: 0, format: "currency", currency: "USD" },
    });
    expect(formatNumber(money, 1234)).toBe("$1,234");
    expect(displayValue(money, 1234, names)).toBe("$1,234");
  });

  it("a select takes one choice unless it says more", () => {
    expect(isMultiple(PRIORITY)).toBe(false);
    expect(isMultiple(TAGS)).toBe(true);
    expect(isMultiple(makeField("f-x", "X", "select"))).toBe(false);
    expect(isMultiple(ASSIGNEE)).toBe(true);
  });
});

describe("emptyColumnIds", () => {
  const timer = makeField("f-timer", "Timer", "timer");
  const fields = [NAME, POINTS, PRIORITY, timer];

  it("lists the columns that have no value in any row", () => {
    const rows = [makeRecord("a", { "f-name": "A", "f-points": 3 }), makeRecord("b", { "f-name": "B", "f-priority": "" })];
    expect(emptyColumnIds(fields, rows)).toEqual(["f-priority"]);
  });

  it("keeps the first column and the timers, and says nothing without rows", () => {
    expect(emptyColumnIds(fields, [makeRecord("a", {})])).toEqual(["f-points", "f-priority"]);
    expect(emptyColumnIds(fields, [])).toEqual([]);
  });
});
