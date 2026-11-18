import { cn } from "@/lib/cn";

import { inkFor } from "./colors";

/** The name of an option on its own color. The text is black or white, whichever reads better. */
export function OptionBadge({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      style={{ backgroundColor: color, color: inkFor(color).color }}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}
