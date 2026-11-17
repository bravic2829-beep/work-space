/** A date and time in the reader's own format and time zone. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** A day written 2026-11-15 as "Nov 15". */
export function formatShortDay(ymd: string): string {
  const [year, month, day] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** A date in the reader's own format and time zone. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
