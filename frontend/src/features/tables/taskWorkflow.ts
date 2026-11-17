import type { ReviewAction } from "./api";
import type { FieldItem, RecordItem } from "./schema";

export type StatusKind = "todo" | "in_progress" | "review" | "done" | "paused" | "blocked";

const STATUS_KINDS: readonly string[] = ["todo", "in_progress", "review", "done", "paused", "blocked"];

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
        if (typeof kind === "string" && STATUS_KINDS.includes(kind)) return kind as StatusKind;
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
  reviewer = false,
  /** An organization admin: every step, on every task. */
  admin = false,
): ReviewStep[] {
  const kind = statusKind(fields, record);
  if (kind === null) return [];
  const steps: ReviewStep[] = [];
  const assigned = assigneeIds(fields, record).includes(currentUserId);
  if ((assigned || admin) && kind !== "review" && kind !== "done") {
    steps.push({ action: "submit", label: "Report as done" });
  }
  if ((record.created_by === currentUserId || reviewer || admin) && kind === "review") {
    steps.push({ action: "approve", label: "Approve" });
    steps.push({ action: "reject", label: "Send back" });
  }
  return steps;
}

/**
 * Pause, report a blocker, or pick the work up again. The people who do the work or give it may
 * (the assignees, the person who created the task, a reviewer, an admin). The backend decides for
 * real; this only avoids offering buttons that are certain to be refused.
 */
export function holdSteps(
  fields: FieldItem[],
  record: RecordItem,
  currentUserId: string,
  reviewer = false,
  admin = false,
): ReviewStep[] {
  const kind = statusKind(fields, record);
  if (kind === null || kind === "review" || kind === "done") return [];
  const may =
    assigneeIds(fields, record).includes(currentUserId) ||
    record.created_by === currentUserId ||
    reviewer ||
    admin;
  if (!may) return [];
  if (kind === "paused") {
    return [
      { action: "resume", label: "Resume" },
      { action: "block", label: "Report a blocker" },
    ];
  }
  if (kind === "blocked") return [{ action: "resume", label: "Unblock" }];
  return [
    { action: "pause", label: "Pause" },
    { action: "block", label: "Report a blocker" },
  ];
}
