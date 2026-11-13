import { describe, expect, it } from "vitest";

import { isHealthResponse, isReadyResponse } from "./schema";

describe("isHealthResponse", () => {
  it("accepts the expected shape", () => {
    expect(isHealthResponse({ status: "ok" })).toBe(true);
  });

  it.each([null, undefined, "ok", 42, [], {}, { status: "down" }])("rejects %j", (value) => {
    expect(isHealthResponse(value)).toBe(false);
  });
});

describe("isReadyResponse", () => {
  it("accepts ok and unavailable shapes", () => {
    expect(isReadyResponse({ status: "ok", database: "ok" })).toBe(true);
    expect(isReadyResponse({ status: "unavailable", database: "error" })).toBe(true);
  });

  it.each([
    null,
    {},
    { status: "ok" },
    { status: "ok", database: "maybe" },
    { status: "weird", database: "ok" },
    "text",
  ])("rejects %j", (value) => {
    expect(isReadyResponse(value)).toBe(false);
  });
});
