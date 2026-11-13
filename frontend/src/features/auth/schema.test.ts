import { describe, expect, it } from "vitest";

import { adminUser, sampleUser } from "@/test/fixtures";

import { isOrgAdmin, isUser } from "./schema";

describe("isUser", () => {
  it("accepts a complete user", () => {
    expect(isUser(sampleUser())).toBe(true);
    expect(isUser(sampleUser({ department_id: "d-1", manager_id: "u-2" }))).toBe(true);
  });

  it.each([
    null,
    undefined,
    "user",
    [],
    {},
    { ...sampleUser(), id: 1 },
    { ...sampleUser(), org_role: "root" },
    { ...sampleUser(), level: "boss" },
    { ...sampleUser(), status: "deleted" },
    { ...sampleUser(), department_id: 5 },
    { ...sampleUser(), manager_id: undefined },
  ])("rejects %j", (value) => {
    expect(isUser(value)).toBe(false);
  });
});

describe("isOrgAdmin", () => {
  it("is true only for owners and admins", () => {
    expect(isOrgAdmin(adminUser)).toBe(true);
    expect(isOrgAdmin(sampleUser({ org_role: "owner" }))).toBe(true);
    expect(isOrgAdmin(sampleUser({ org_role: "member" }))).toBe(false);
  });

  it("does not depend on the business level", () => {
    expect(isOrgAdmin(sampleUser({ level: "division_manager", org_role: "member" }))).toBe(false);
  });
});
