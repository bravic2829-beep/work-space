import { cn } from "@/lib/cn";

import { DataTable } from "./DataTable";

/** A grey bar that stands for text that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-3 rounded bg-line motion-safe:animate-pulse", className)} />;
}

// Widths cycle so the rows do not look like a stamped pattern.
const WIDTHS = ["w-36", "w-24", "w-16", "w-28", "w-20"];

/**
 * A table of grey bars with the real column headings, shown while the rows load. It keeps about
 * the height of the finished table, so the page does not jump when the rows arrive.
 */
export function SkeletonTable({
  headings,
  rows = 5,
  label = "Loading…",
}: {
  headings: string[];
  rows?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <DataTable dense aria-hidden>
        <thead>
          <tr>
            {headings.map((heading) => (
              <th key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {headings.map((heading, column) => (
                <td key={heading}>
                  <Skeleton className={WIDTHS[(row + column) % WIDTHS.length]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}
