/** A date and time in the reader's own format and time zone. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** A date in the reader's own format and time zone. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
