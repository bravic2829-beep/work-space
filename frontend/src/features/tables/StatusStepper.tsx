import { cn } from "@/lib/cn";

import type { FieldItem, RecordItem } from "./schema";
import { statusKind, type StatusKind } from "./taskWorkflow";

const STEPS: { kind: StatusKind; label: string }[] = [
  { kind: "todo", label: "To do" },
  { kind: "in_progress", label: "In progress" },
  { kind: "review", label: "Review" },
  { kind: "done", label: "Done" },
];

/**
 * Where a task is on its way: To do, In progress, Review, Done. It only shows the position (the
 * buttons beside it move the task). Nothing is drawn for a table with no status column.
 */
export function StatusStepper({ fields, record }: { fields: FieldItem[]; record: RecordItem }) {
  const kind = statusKind(fields, record);
  if (kind === null) return null;
  const current = STEPS.findIndex((step) => step.kind === kind);

  return (
    <ol
      aria-label="Task progress"
      className="m-0 flex list-none flex-wrap items-center gap-y-1 p-0 text-xs text-muted"
    >
      {STEPS.map((step, index) => {
        const done = index < current || kind === "done";
        const active = index === current && kind !== "done";
        return (
          <li
            key={step.kind}
            aria-current={index === current ? "step" : undefined}
            className="flex items-center"
          >
            <span
              aria-hidden
              className={cn(
                "mr-1 size-2 shrink-0 rounded-full",
                done && "bg-success",
                active && "bg-primary",
                !done && !active && "bg-line-strong",
              )}
            />
            <span className={cn(index === current && "font-semibold text-fg")}>{step.label}</span>
            {index < STEPS.length - 1 && (
              <span aria-hidden className="mx-1.5 h-0.5 w-4 shrink-0 bg-line-strong" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
