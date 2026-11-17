import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/features/tables/StatusBadge";
import { cn } from "@/lib/cn";

import { daysLate, dueInfo, isDone, type DueTone, type MyTask } from "./schema";

const DUE_TONE: Record<DueTone, string> = {
  overdue: "font-semibold text-danger",
  today: "font-semibold text-primary",
  normal: "text-muted",
};

function pluralDays(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** A task is overdue when its due day has passed and it is not finished. */
export function isOverdue(task: MyTask, today: string): boolean {
  return !isDone(task) && dueInfo(task.due_date, today)?.tone === "overdue";
}

/** A task is due today when its due day is today and it is not finished. */
export function isDueToday(task: MyTask, today: string): boolean {
  return !isDone(task) && dueInfo(task.due_date, today)?.tone === "today";
}

/** How the due date is written: in full, only the days late, or not at all. */
type DueStyle = "full" | "days-late" | "none";

/** A list of tasks: state icon, name and table, due date in words, and the status label. */
export function TaskList({
  items,
  today,
  dueStyle = "full",
}: {
  items: MyTask[];
  today: string;
  dueStyle?: DueStyle;
}) {
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
            {due && dueStyle !== "none" && (
              <span
                className={cn(
                  "hidden shrink-0 items-center gap-1 text-[13px] sm:inline-flex",
                  DUE_TONE[due.tone],
                )}
              >
                {due.tone === "overdue" && <AlertTriangle className="size-3.5" aria-hidden />}
                {dueStyle === "days-late" && due.tone === "overdue"
                  ? pluralDays(daysLate(task.due_date ?? "", today))
                  : due.label}
              </span>
            )}
            {task.status && <StatusBadge name={task.status.name} kind={task.status.kind} />}
          </li>
        );
      })}
    </ul>
  );
}

type GroupId = "overdue" | "today" | "later" | "done";

const GROUPS: { id: GroupId; label: string; dueStyle: DueStyle }[] = [
  { id: "overdue", label: "Overdue", dueStyle: "days-late" },
  { id: "today", label: "Today", dueStyle: "none" },
  { id: "later", label: "Later", dueStyle: "full" },
  { id: "done", label: "Done", dueStyle: "full" },
];

function groupOf(task: MyTask, today: string): GroupId {
  if (isDone(task)) return "done";
  if (isOverdue(task, today)) return "overdue";
  return isDueToday(task, today) ? "today" : "later";
}

/** The tasks in groups by urgency: what is late first, then today, then the rest. */
export function GroupedTaskList({ items, today }: { items: MyTask[]; today: string }) {
  return (
    <div className="grid gap-4">
      {GROUPS.map(({ id, label, dueStyle }) => {
        const tasks = items.filter((task) => groupOf(task, today) === id);
        if (tasks.length === 0) return null;
        return (
          <section key={id} aria-label={label} className="grid gap-1.5">
            <h3
              className={cn(
                "m-0 flex items-center justify-between px-1 text-xs font-semibold tracking-wide uppercase",
                id === "overdue" ? "text-danger" : "text-muted",
              )}
            >
              {label}
              <span className="font-mono">{tasks.length}</span>
            </h3>
            <TaskList items={tasks} today={today} dueStyle={dueStyle} />
          </section>
        );
      })}
    </div>
  );
}
