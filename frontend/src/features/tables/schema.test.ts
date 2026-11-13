import { describe, expect, it } from "vitest";

import { FIELDS, makeRecord, makeTable, makeView, makeWorkspace } from "./fixtures";
import {
  isBaseList,
  isDirectoryList,
  isFieldItem,
  isRecordItem,
  isRecordPage,
  isTableDetail,
  isViewItem,
  isWorkspaceList,
} from "./schema";

describe("field guard", () => {
  it("accepts a field and rejects missing or unknown parts", () => {
    expect(isFieldItem(FIELDS[0])).toBe(true);
    expect(isFieldItem({ ...FIELDS[0], type: "formula" })).toBe(false);
    expect(isFieldItem({ ...FIELDS[0], access: "owner" })).toBe(false);
    expect(isFieldItem({ ...FIELDS[0], config: null })).toBe(false);
    expect(isFieldItem({ ...FIELDS[0], position: "1" })).toBe(false);
    expect(isFieldItem(null)).toBe(false);
    expect(isFieldItem([])).toBe(false);
  });
});

describe("table guard", () => {
  it("accepts a table with or without a role", () => {
    expect(isTableDetail(makeTable("editor"))).toBe(true);
    expect(isTableDetail(makeTable(null))).toBe(true);
  });

  it("rejects a table with a bad field or a bad role", () => {
    expect(isTableDetail({ ...makeTable(), fields: [{ id: 1 }] })).toBe(false);
    expect(isTableDetail({ ...makeTable(), my_role: "boss" })).toBe(false);
    expect(isTableDetail({ ...makeTable(), fields: "none" })).toBe(false);
  });
});

describe("record guards", () => {
  it("accepts records and pages", () => {
    const record = makeRecord("r-1", { a: 1 });
    expect(isRecordItem(record)).toBe(true);
    expect(isRecordPage({ items: [record], next_cursor: null })).toBe(true);
    expect(isRecordPage({ items: [], next_cursor: "abc" })).toBe(true);
  });

  it("rejects a page with a broken record or cursor", () => {
    expect(isRecordPage({ items: [{ id: "x" }], next_cursor: null })).toBe(false);
    expect(isRecordPage({ items: [], next_cursor: 5 })).toBe(false);
    expect(isRecordPage({ items: [] })).toBe(false);
    expect(isRecordItem({ ...makeRecord("r", {}), version: "1" })).toBe(false);
    expect(isRecordItem({ ...makeRecord("r", {}), data: [] })).toBe(false);
  });
});

describe("view guard", () => {
  it("accepts a view and rejects a broken config", () => {
    expect(isViewItem(makeView("v-1", "Mine"))).toBe(true);
    const good = makeView("v-1", "Mine", { sort: [{ field: "f", direction: "asc" }] });
    expect(isViewItem(good)).toBe(true);
    expect(isViewItem({ ...good, config: { ...good.config, sort: [{ field: "f", direction: "up" }] } })).toBe(false);
    expect(isViewItem({ ...good, config: { filter: [], sort: [] } })).toBe(false);
    expect(isViewItem({ ...good, config: null })).toBe(false);
  });
});

describe("list guards", () => {
  it("check every item", () => {
    expect(isWorkspaceList([makeWorkspace("w", "W")])).toBe(true);
    expect(isWorkspaceList([{ id: "w" }])).toBe(false);
    expect(isBaseList([{ id: "b", workspace_id: "w", name: "B" }])).toBe(true);
    expect(isBaseList([{ id: "b" }])).toBe(false);
    expect(isDirectoryList([{ id: "u", employee_code: "E1", full_name: "N" }])).toBe(true);
    expect(isDirectoryList([{ id: "u", employee_code: "E1", full_name: "N", password_hash: "x" }])).toBe(true);
    expect(isDirectoryList([{ id: "u" }])).toBe(false);
    expect(isDirectoryList("none")).toBe(false);
  });
});
