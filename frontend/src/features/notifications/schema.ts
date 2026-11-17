import { isRecord, pageOf } from "@/lib/api/guards";

export type NotificationType = "task_assigned" | "review_requested" | "changes_requested";

const TYPES: string[] = ["task_assigned", "review_requested", "changes_requested"];

export type Notification = {
  id: string;
  type: NotificationType;
  record_id: string;
  table_id: string;
  /** Null when the task name is hidden from this person. */
  record_name: string | null;
  actor: { id: string; full_name: string };
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = { items: Notification[]; next_cursor: string | null };

export function isNotification(value: unknown): value is Notification {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    TYPES.includes(value.type) &&
    typeof value.record_id === "string" &&
    typeof value.table_id === "string" &&
    (value.record_name === null || typeof value.record_name === "string") &&
    isRecord(value.actor) &&
    typeof value.actor.id === "string" &&
    typeof value.actor.full_name === "string" &&
    (value.read_at === null || typeof value.read_at === "string") &&
    typeof value.created_at === "string"
  );
}

export const isNotificationPage = pageOf(isNotification);

export function isUnreadCount(value: unknown): value is { unread: number } {
  return (
    isRecord(value) &&
    typeof value.unread === "number" &&
    Number.isInteger(value.unread) &&
    value.unread >= 0
  );
}

/** The sentence shown for a notification. */
export function describe(notification: Notification): string {
  const task = notification.record_name ? `"${notification.record_name}"` : "a task";
  if (notification.type === "review_requested") {
    return `${notification.actor.full_name} asks you to review ${task}`;
  }
  if (notification.type === "changes_requested") {
    return `${notification.actor.full_name} sent ${task} back for changes`;
  }
  return `${notification.actor.full_name} assigned you ${task}`;
}
