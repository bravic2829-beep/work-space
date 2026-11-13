import type { ReviewAction } from "./api";
import type { FieldItem, RecordItem } from "./schema";

export type StatusKind = "todo" | "in_progress" | "review" | "done";

export function fieldBySemantic(fields: FieldItem[], semantic: string): FieldItem | undefined {
  return fields.find((field) => field.semantic === semantic);
}

/** The column that names a task: the first text column (the same rule as the backend). */
export function titleField(fields: FieldItem[]): FieldItem | undefined {
  return fields.filter((field) => field.type === "text").sort((a, b) => a.position - b.position)[0];
}

/** The kind of the task's status. A task with no status yet counts as "todo". Null: no status column. */
export function statusKind(fields: FieldItem[], record: RecordItem): StatusKind | null {
  const status = fieldBySemantic(fields, "status");
  if (!status) return null;
  const chosen = record.data[status.id];
  const options = status.config.options;
  if (Array.isArray(options)) {
    for (const option of options) {
      if (
        typeof option === "object" &&
        option !== null &&
        (option as { id?: unknown }).id === chosen
      ) {
        const kind = (option as { kind?: unknown }).kind;
        if (kind === "todo" || kind === "in_progress" || kind === "review" || kind === "done") {
          return kind;
        }
      }
    }
  }
  return "todo";
}

export function assigneeIds(fields: FieldItem[], record: RecordItem): string[] {
  const column = fieldBySemantic(fields, "assignee");
  const value = column ? record.data[column.id] : undefined;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

export type ReviewStep = { action: ReviewAction; label: string };

/**
 * The review buttons this person may press. The backend decides for real; this only avoids
 * offering buttons that are certain to be refused (same rules as docs/usecases.md 3.3).
 */
export function reviewSteps(
  fields: FieldItem[],
  record: RecordItem,
  currentUserId: string,
): ReviewStep[] {
  const kind = statusKind(fields, record);
  if (kind === null) return [];
  const steps: ReviewStep[] = [];
  if (assigneeIds(fields, record).includes(currentUserId) && kind !== "review" && kind !== "done") {
    steps.push({ action: "submit", label: "Report as done" });
  }
  if (record.created_by === currentUserId && kind === "review") {
    steps.push({ action: "approve", label: "Approve" });
    steps.push({ action: "reject", label: "Send back" });
  }
  return steps;
}
