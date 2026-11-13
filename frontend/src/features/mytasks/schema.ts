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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function isMyTaskPage(value: unknown): value is MyTaskPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isMyTask) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}

/** Today in the browser's own time zone, as 2026-11-13 (the server cannot know the person's day). */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
