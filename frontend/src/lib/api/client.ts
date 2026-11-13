export type FieldError = { field: string; message: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly fieldErrors: FieldError[] = [],
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

type RequestOptions<T> = {
  body?: unknown;
  /** Checks the shape of the response. Data from the network is never trusted. */
  guard?: (value: unknown) => value is T;
  signal?: AbortSignal;
  /** Accept a valid body even with an error status (the readiness check answers 503 + body). */
  acceptErrorBody?: boolean;
  /** Extra request headers, for example `If-Match` when changing a record. */
  headers?: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the field errors of an RFC 9457 Problem Details body. */
function readFieldErrors(body: Record<string, unknown>): FieldError[] {
  if (!Array.isArray(body.errors)) return [];
  return body.errors.flatMap((item): FieldError[] =>
    isRecord(item) && typeof item.field === "string" && typeof item.message === "string"
      ? [{ field: item.field, message: item.message }]
      : [],
  );
}

function problemFrom(body: unknown, response: Response): ApiError {
  const retryAfter = Number(response.headers.get("Retry-After"));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  if (isRecord(body)) {
    const message =
      (typeof body.detail === "string" && body.detail) ||
      (typeof body.title === "string" && body.title) ||
      `Request failed (${response.status})`;
    return new ApiError(message, response.status, readFieldErrors(body), retryAfterSeconds);
  }
  return new ApiError(`Request failed (${response.status})`, response.status, [], retryAfterSeconds);
}

/**
 * Calls our backend. The browser talks to the same origin (/api/*, proxied by Next.js), so the
 * HttpOnly session cookie is sent automatically and never touched by JavaScript.
 */
export async function apiRequest<T = void>(
  method: Method,
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Network error: the server could not be reached");
  }

  if (response.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("The server returned an invalid response", response.status);
  }

  if (!response.ok) {
    if (options.acceptErrorBody && options.guard?.(body)) return body;
    throw problemFrom(body, response);
  }
  if (options.guard && !options.guard(body)) {
    throw new ApiError("The server returned an unexpected response", response.status);
  }
  return body as T;
}

/** GET a JSON endpoint and validate the response (a valid body is accepted with any status). */
export function apiGet<T>(
  path: string,
  guard: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  return apiRequest<T>("GET", path, { guard, signal, acceptErrorBody: true });
}
