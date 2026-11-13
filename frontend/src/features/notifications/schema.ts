export type NotificationType = "task_assigned" | "review_requested";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNotification(value: unknown): value is Notification {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.type === "task_assigned" || value.type === "review_requested") &&
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

export function isNotificationPage(value: unknown): value is NotificationPage {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isNotification) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}

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
  return `${notification.actor.full_name} assigned you ${task}`;
}
