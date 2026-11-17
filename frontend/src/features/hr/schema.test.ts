import { describe, expect, it } from "vitest";

import { sampleUser } from "@/test/fixtures";

import { isDepartment, isDepartmentList, isUserPage } from "./schema";

const division = {
  id: "d-1",
  name: "Sales",
  kind: "division",
  parent_id: null,
  head_user_id: null,
  member_count: 0,
};

describe("isDepartment", () => {
  it("accepts valid departments", () => {
    expect(isDepartment(division)).toBe(true);
    expect(isDepartment({ ...division, kind: "department", parent_id: "d-0" })).toBe(true);
  });

  it.each([
    null,
    {},
    { ...division, kind: "team" },
    { ...division, parent_id: 3 },
    { ...division, head_user_id: 7 },
    { id: "d-1", name: "Sales", kind: "division", parent_id: null },
    "x",
  ])("rejects %j", (value) => {
    expect(isDepartment(value)).toBe(false);
  });

  it("checks every item of a list", () => {
    expect(isDepartmentList([division, division])).toBe(true);
    expect(isDepartmentList([division, { nope: 1 }])).toBe(false);
    expect(isDepartmentList({})).toBe(false);
  });
});

describe("isUserPage", () => {
  it("accepts a page with and without a next cursor", () => {
    expect(isUserPage({ items: [sampleUser()], next_cursor: null })).toBe(true);
    expect(isUserPage({ items: [], next_cursor: "abc" })).toBe(true);
  });

  it.each([
    null,
    {},
    { items: [{ bad: true }], next_cursor: null },
    { items: [], next_cursor: 5 },
    { items: "no", next_cursor: null },
  ])("rejects %j", (value) => {
    expect(isUserPage(value)).toBe(false);
  });
});
