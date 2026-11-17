import { Check } from "lucide-react";

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
 * buttons below it move the task). Nothing is drawn for a table with no status column.
 */
export function StatusStepper({ fields, record }: { fields: FieldItem[]; record: RecordItem }) {
  const actual = statusKind(fields, record);
  if (actual === null) return null;
  // A paused or blocked task is still on the "In progress" step; a tag next to the steps says so.
  const held = actual === "paused" || actual === "blocked" ? actual : null;
  const kind: StatusKind = held ? "in_progress" : actual;
  const current = STEPS.findIndex((step) => step.kind === kind);

  return (
    <>
    <ol aria-label="Task progress" className="m-0 flex list-none items-start p-0">
      {STEPS.map((step, index) => {
        const done = index < current || kind === "done";
        const active = index === current && kind !== "done";
        return (
          <li
            key={step.kind}
            aria-current={index === current ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
          >
            <span className="flex items-center">
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                  done && "border-primary bg-primary text-primary-fg",
                  active && "border-primary bg-primary",
                  !done && !active && "border-line-strong bg-surface",
                )}
              >
                {done && <Check className="size-3" strokeWidth={3.5} />}
                {active && <span className="size-1.5 rounded-full bg-primary-fg" />}
              </span>
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn("mx-1 h-0.5 flex-1", done ? "bg-primary" : "bg-line-strong")}
                />
              )}
            </span>
            <span
              className={cn(
                "text-xs",
                index === current ? "font-semibold text-fg" : done ? "text-fg" : "text-muted",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
    {held && (
      <p
        role="status"
        className={cn(
          "m-0 mt-2 text-xs font-semibold",
          held === "blocked" ? "text-danger" : "text-muted",
        )}
      >
        {held === "blocked"
          ? "Blocked: this task cannot move until the blocker is solved."
          : "Paused: work on this task is on hold."}
      </p>
    )}
    </>
  );
}
