import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet, apiRequest } from "./client";

type Payload = { value: number };

function isPayload(value: unknown): value is Payload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { value?: unknown }).value === "number"
  );
}

function stubFetch(response: Response | Error | DOMException) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Response) return response;
    throw response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("returns a valid body", async () => {
    stubFetch(Response.json({ value: 1 }));
    await expect(apiGet("/x", isPayload)).resolves.toEqual({ value: 1 });
  });

  it("sends no cookies cross-origin and never caches", async () => {
    const fetchMock = stubFetch(Response.json({ value: 1 }));
    await apiGet("/x", isPayload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/x",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("accepts a valid body that comes with an error status (readiness 503)", async () => {
    stubFetch(Response.json({ value: 2 }, { status: 503 }));
    await expect(apiGet("/x", isPayload)).resolves.toEqual({ value: 2 });
  });

  it("rejects a body with the wrong shape", async () => {
    stubFetch(Response.json({ value: "nope" }));
    await expect(apiGet("/x", isPayload)).rejects.toBeInstanceOf(ApiError);
  });

  it("reports the status of a failed request without a usable body", async () => {
    stubFetch(Response.json({ detail: "boom" }, { status: 500 }));
    await expect(apiGet("/x", isPayload)).rejects.toMatchObject({ status: 500 });
  });

  it("rejects a non-JSON body", async () => {
    stubFetch(new Response("<html>oops</html>", { status: 502 }));
    await expect(apiGet("/x", isPayload)).rejects.toMatchObject({ status: 502 });
  });

  it("turns a network failure into an ApiError", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await expect(apiGet("/x", isPayload)).rejects.toBeInstanceOf(ApiError);
  });

  it("lets an abort through unchanged", async () => {
    stubFetch(new DOMException("aborted", "AbortError"));
    await expect(apiGet("/x", isPayload)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("apiRequest", () => {
  function problem(status: number, body: object, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/problem+json", ...headers },
    });
  }

  it("sends a JSON body with the right method and header", async () => {
    const fetchMock = stubFetch(Response.json({ value: 1 }, { status: 201 }));
    await apiRequest("POST", "/x", { body: { a: 1 }, guard: isPayload });
    expect(fetchMock).toHaveBeenCalledWith(
      "/x",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("does not set a content type when there is no body", async () => {
    const fetchMock = stubFetch(Response.json({ value: 1 }));
    await apiRequest("GET", "/x", { guard: isPayload });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty("Content-Type");
    expect(init?.body).toBeUndefined();
  });

  it("returns nothing for 204 No Content", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiRequest("DELETE", "/x")).resolves.toBeUndefined();
  });

  it("turns a Problem Details body into an ApiError with the status and detail", async () => {
    stubFetch(problem(409, { title: "Conflict", status: 409, detail: "Code already in use." }));
    await expect(apiRequest("POST", "/x", { body: {} })).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      message: "Code already in use.",
    });
  });

  it("reads the per-field errors of a 422 answer", async () => {
    stubFetch(
      problem(422, {
        title: "Unprocessable Content",
        detail: "One or more fields are invalid.",
        errors: [
          { field: "password", message: "Too short" },
          { field: 5, message: "ignored: not a valid item" },
        ],
      }),
    );
    const error = await apiRequest("POST", "/x", { body: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors).toEqual([{ field: "password", message: "Too short" }]);
  });

  it("keeps the Retry-After of a 429 answer", async () => {
    stubFetch(problem(429, { title: "Too Many Requests" }, { "Retry-After": "120" }));
    await expect(apiRequest("POST", "/x", { body: {} })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 120,
    });
  });

  it("is strict: an error status is an error even if the body fits the guard", async () => {
    stubFetch(Response.json({ value: 3 }, { status: 500 }));
    await expect(apiRequest("GET", "/x", { guard: isPayload })).rejects.toMatchObject({
      status: 500,
    });
  });

  it("falls back to a generic message when the error body is not Problem Details", async () => {
    stubFetch(Response.json(["weird"], { status: 400 }));
    await expect(apiRequest("GET", "/x")).rejects.toMatchObject({
      message: "Request failed (400)",
    });
  });

  it("rejects a successful answer that does not match the guard", async () => {
    stubFetch(Response.json({ value: "nope" }));
    await expect(apiRequest("GET", "/x", { guard: isPayload })).rejects.toBeInstanceOf(ApiError);
  });
});
