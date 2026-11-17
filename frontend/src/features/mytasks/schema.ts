import { isRecord, pageOf } from "@/lib/api/guards";

export type MyTask = {
  id: string;
  table_id: string;
  table_name: string;
  name: string | null;
  due_date: string | null;
  status: { name: string; kind: string } | null;
  created_at: string;
};

export type MyTaskPage = { items: MyTask[]; next_cursor: string | null };

export function isMyTask(value: unknown): value is MyTask {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.table_id === "string" &&
    typeof value.table_name === "string" &&
    (value.name === null || typeof value.name === "string") &&
    (value.due_date === null || typeof value.due_date === "string") &&
    (value.status === null ||
      (isRecord(value.status) &&
        typeof value.status.name === "string" &&
        typeof value.status.kind === "string")) &&
    typeof value.created_at === "string"
  );
}

export const isMyTaskPage = pageOf(isMyTask);

/** Today in the browser's own time zone, as 2026-11-13 (the server cannot know the person's day). */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export type DueTone = "overdue" | "today" | "normal";
export type DueInfo = { label: string; tone: DueTone };

function dayNumber(ymd: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000);
}

/**
 * How a due date reads in a list: "Overdue 3 days", "Today", "Tomorrow", or the date itself.
 * `today` is a YYYY-MM-DD day (see localToday). Null when there is no due date.
 */
export function dueInfo(due: string | null, today: string): DueInfo | null {
  if (due === null) return null;
  const dueDay = dayNumber(due);
  const nowDay = dayNumber(today);
  if (dueDay === null || nowDay === null) return { label: due, tone: "normal" };
  const diff = dueDay - nowDay;
  if (diff < 0) {
    const days = -diff;
    return { label: `Overdue ${days} ${days === 1 ? "day" : "days"}`, tone: "overdue" };
  }
  if (diff === 0) return { label: "Today", tone: "today" };
  if (diff === 1) return { label: "Tomorrow", tone: "normal" };
  return { label: due.slice(0, 10), tone: "normal" };
}
