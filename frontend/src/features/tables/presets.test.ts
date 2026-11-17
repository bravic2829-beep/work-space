import { describe, expect, it } from "vitest";

import { ASSIGNEE, DUE, NAME, makeField } from "./fixtures";
import { isPreset, presetFilter } from "./presets";
import type { FieldItem } from "./schema";

const STATUS = makeField("f-status", "Status", "status", {
  semantic: "status",
  config: {
    options: [
      { id: "o-todo", name: "To do", kind: "todo" },
      { id: "o-doing", name: "In progress", kind: "in_progress" },
      { id: "o-review", name: "Pending review", kind: "review" },
      { id: "o-done", name: "Done", kind: "done" },
      { id: "o-paused", name: "Paused", kind: "paused" },
      { id: "o-blocked", name: "Blocked", kind: "blocked" },
    ],
  },
});
const DUE_DATE = { ...DUE, semantic: "due_date" };
const FIELDS: FieldItem[] = [NAME, ASSIGNEE, STATUS, DUE_DATE].map((f, position) => ({
  ...f,
  position,
}));

describe("the ready-made filters of the reports", () => {
  const TODAY = "2026-11-17";

  it("recognises its names", () => {
    expect(isPreset("overdue")).toBe(true);
    expect(isPreset("everything")).toBe(false);
    expect(isPreset(null)).toBe(false);
  });

  it("open means not done, so a task with no status is included", () => {
    expect(presetFilter("open", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-status", op: "neq", value: "o-done" },
    ]);
  });

  it("overdue is open and due before today", () => {
    expect(presetFilter("overdue", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-status", op: "neq", value: "o-done" },
      { field: "f-due", op: "lt", value: TODAY },
    ]);
  });

  it("due today is open and due on this day", () => {
    expect(presetFilter("due_today", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-status", op: "neq", value: "o-done" },
      { field: "f-due", op: "eq", value: TODAY },
    ]);
  });

  it("picks the statuses of a kind", () => {
    expect(presetFilter("review", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-status", op: "in", value: ["o-review"] },
    ]);
    expect(presetFilter("done", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-status", op: "in", value: ["o-done"] },
    ]);
    expect(presetFilter("blocked", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-status", op: "in", value: ["o-blocked"] },
    ]);
    expect(presetFilter("paused", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-status", op: "in", value: ["o-paused"] },
    ]);
  });

  it("unassigned looks for an empty assignee", () => {
    expect(presetFilter("unassigned", FIELDS, TODAY)?.filter).toEqual([
      { field: "f-assignee", op: "is_empty" },
    ]);
  });

  it("narrows to one person, except for unassigned", () => {
    expect(presetFilter("open", FIELDS, TODAY, "u-1")?.filter).toEqual([
      { field: "f-status", op: "neq", value: "o-done" },
      { field: "f-assignee", op: "contains", value: "u-1" },
    ]);
    expect(presetFilter("unassigned", FIELDS, TODAY, "u-1")?.filter).toEqual([
      { field: "f-assignee", op: "is_empty" },
    ]);
  });

  it("gives nothing when the table lacks the column or the status kind", () => {
    expect(presetFilter("open", [NAME], TODAY)).toBeNull();
    expect(presetFilter("overdue", [NAME, STATUS], TODAY)).toBeNull(); // no due date
    expect(presetFilter("unassigned", [NAME, STATUS], TODAY)).toBeNull();
    const old = { ...STATUS, config: { options: [{ id: "a", name: "To do", kind: "todo" }] } };
    expect(presetFilter("blocked", [NAME, ASSIGNEE, old], TODAY)).toBeNull();
  });

  it("names the filter", () => {
    expect(presetFilter("blocked", FIELDS, TODAY)?.label).toBe("Blocked tasks");
  });
});
