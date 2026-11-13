import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import {
  createView,
  listRecords,
  lookupUsers,
  recordQueryString,
  updateRecord,
} from "./api";
import { makeRecord } from "./fixtures";

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("record query string", () => {
  it("has a limit and nothing else by default", () => {
    expect(recordQueryString({ filter: [], sort: [] })).toBe("limit=50");
  });

  it("repeats sort for every column and encodes the filter as JSON", () => {
    const query = recordQueryString({
      filter: [{ field: "f1", op: "gt", value: 5 }],
      sort: [
        { field: "f1", direction: "desc" },
        { field: "f2", direction: "asc" },
      ],
      cursor: "abc=",
      limit: 20,
    });
    const params = new URLSearchParams(query);
    expect(params.get("limit")).toBe("20");
    expect(params.getAll("sort")).toEqual(["f1:desc", "f2:asc"]);
    expect(JSON.parse(params.get("filter") ?? "")).toEqual([{ field: "f1", op: "gt", value: 5 }]);
    expect(params.get("cursor")).toBe("abc=");
  });

  it("keeps characters of the filter that would break a URL safe", () => {
    const query = recordQueryString({
      filter: [{ field: "f1", op: "contains", value: "a&b=c#d%" }],
      sort: [],
    });
    expect(new URLSearchParams(query).get("filter")).toContain("a&b=c#d%");
    expect(query).not.toContain("a&b");
  });
});

describe("talking to the API", () => {
  it("sends the version of a record as If-Match", async () => {
    const fetchMock = stubFetch(Response.json(makeRecord("r-1", { a: 1 }, { version: 4 })));
    const saved = await updateRecord("r-1", 3, { a: 1 });
    expect(saved.version).toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/records/r-1");
    expect(init?.method).toBe("PATCH");
    expect(new Headers(init?.headers).get("If-Match")).toBe('"3"');
    expect(JSON.parse(String(init?.body))).toEqual({ data: { a: 1 } });
  });

  it("surfaces a conflict as an ApiError with its status", async () => {
    stubFetch(Response.json({ title: "Precondition Failed", detail: "Changed." }, { status: 412 }));
    await expect(updateRecord("r-1", 1, {})).rejects.toMatchObject({ status: 412, message: "Changed." });
  });

  it("surfaces the field errors of a validation failure", async () => {
    stubFetch(
      Response.json(
        { detail: "One or more values are invalid.", errors: [{ field: "f-1", message: "Bad." }] },
        { status: 422 },
      ),
    );
    const error = await updateRecord("r-1", 1, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual([{ field: "f-1", message: "Bad." }]);
  });

  it("refuses a record list that does not look like one", async () => {
    stubFetch(Response.json({ items: [{ nope: true }], next_cursor: null }));
    await expect(listRecords("t-1", { filter: [], sort: [] })).rejects.toThrow(
      "The server returned an unexpected response",
    );
  });

  it("looks colleagues up with one ids parameter each", async () => {
    const fetchMock = stubFetch(Response.json([{ id: "a", employee_code: "E1", full_name: "A" }]));
    await lookupUsers(["a", "b"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/directory/users?ids=a&ids=b");
  });

  it("saves a view with its config", async () => {
    const fetchMock = stubFetch(
      Response.json(
        { id: "v", table_id: "t", name: "Mine", config: { filter: [], sort: [], hidden_fields: [] } },
        { status: 201 },
      ),
    );
    await createView("t-1", "Mine", { filter: [], sort: [], hidden_fields: ["f-1"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/tables/t-1/views");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Mine",
      config: { filter: [], sort: [], hidden_fields: ["f-1"] },
    });
  });
});
