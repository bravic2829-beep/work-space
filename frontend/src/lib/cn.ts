/** Joins class names, skipping anything that is not a string (false, null, undefined). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
