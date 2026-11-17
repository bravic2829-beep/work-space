import { ApiError } from "./client";

/** The server's message for an API error, or `fallback` for anything else (a network failure...). */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** Is this an API error with exactly this HTTP status? */
export function hasStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}
