/** Small building blocks for the type guards that check what the server sent. */

export type Page<T> = { items: T[]; next_cursor: string | null };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isArrayOf<T>(guard: (value: unknown) => value is T) {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

/** A guard for `{ items, next_cursor }`, the shape of every list that has a "Load more". */
export function pageOf<T>(guard: (value: unknown) => value is T) {
  return (value: unknown): value is Page<T> =>
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(guard) &&
    isStringOrNull(value.next_cursor);
}
