import { cn } from "@/lib/cn";

/**
 * Up to two initials of a name: "Tran Thi B" gives "TB". A trailing employee code in brackets
 * ("Tran Thi B (NV102)", the form the name caches use) is not part of the name.
 */
export function initials(name: string): string {
  const words = name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

/** A round badge with the initials of a person. Decorative: the name is always written nearby. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
