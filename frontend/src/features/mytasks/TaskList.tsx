import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/features/tables/StatusBadge";
import { cn } from "@/lib/cn";

import { dueInfo, isDone, type DueTone, type MyTask } from "./schema";

const DUE_TONE: Record<DueTone, string> = {
  overdue: "font-semibold text-danger",
  today: "font-semibold text-primary",
  normal: "text-muted",
};

/** A task is overdue when its due day has passed and it is not finished. */
export function isOverdue(task: MyTask, today: string): boolean {
  return !isDone(task) && dueInfo(task.due_date, today)?.tone === "overdue";
}

/** A task is due today when its due day is today and it is not finished. */
export function isDueToday(task: MyTask, today: string): boolean {
  return !isDone(task) && dueInfo(task.due_date, today)?.tone === "today";
}

/** A list of tasks: state icon, name and table, due date in words, and the status label. */
export function TaskList({ items, today }: { items: MyTask[]; today: string }) {
  return (
    <ul
      aria-label="Tasks"
      className="m-0 list-none divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface p-0"
    >
      {items.map((task) => {
        const done = isDone(task);
        // A finished task is never "overdue": it just shows its date.
        const due = done
          ? task.due_date
            ? { label: task.due_date.slice(0, 10), tone: "normal" as const }
            : null
          : dueInfo(task.due_date, today);
        const Icon = done ? CheckCircle2 : Circle;
        return (
          <li
            key={task.id}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
          >
            <Icon
              aria-hidden
              className={cn("size-5 shrink-0", done ? "text-success" : "text-line-strong")}
            />
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <Link
                href={`/tables/${task.table_id}`}
                className={cn(
                  "truncate font-medium no-underline hover:text-primary hover:no-underline",
                  done ? "text-muted line-through" : "text-fg",
                )}
              >
                {task.name ?? "(name hidden)"}
              </Link>
              <span className="truncate text-xs text-muted">{task.table_name}</span>
            </span>
            {due && (
              <span
                className={cn(
                  "hidden shrink-0 items-center gap-1 text-[13px] sm:inline-flex",
                  DUE_TONE[due.tone],
                )}
              >
                {due.tone === "overdue" && <AlertTriangle className="size-3.5" aria-hidden />}
                {due.label}
              </span>
            )}
            {task.status && <StatusBadge name={task.status.name} kind={task.status.kind} />}
          </li>
        );
      })}
    </ul>
  );
}
