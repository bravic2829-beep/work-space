import { apiRequest } from "@/lib/api/client";

import { isRecordItem, type RecordItem } from "./schema";
import { isRecord } from "@/lib/api/guards";

export type ActivityAction =
  | "created"
  | "updated"
  | "submitted"
  | "approved"
  | "sent_back"
  | "timer_started"
  | "timer_stopped"
  | "handed_over";

const ACTIONS: string[] = [
  "created",
  "updated",
  "submitted",
  "approved",
  "sent_back",
  "timer_started",
  "timer_stopped",
  "handed_over",
];

export type ActivityChange = {
  field_id: string;
  field_name: string;
  before: unknown;
  after: unknown;
};

export type ActivityItem = {
  id: string;
  action: ActivityAction;
  actor: { id: string; full_name: string };
  created_at: string;
  changes: ActivityChange[];
  note: string | null;
};

function isChange(value: unknown): value is ActivityChange {
  return (
    isRecord(value) &&
    typeof value.field_id === "string" &&
    typeof value.field_name === "string" &&
    "before" in value &&
    "after" in value
  );
}

export function isActivityItem(value: unknown): value is ActivityItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    ACTIONS.includes(value.action) &&
    isRecord(value.actor) &&
    typeof value.actor.id === "string" &&
    typeof value.actor.full_name === "string" &&
    typeof value.created_at === "string" &&
    Array.isArray(value.changes) &&
    value.changes.every(isChange) &&
    (value.note === null || typeof value.note === "string")
  );
}

export function isActivityList(value: unknown): value is ActivityItem[] {
  return Array.isArray(value) && value.every(isActivityItem);
}

/** The history of a task, newest first, without the columns the caller may not see. */
export function listActivity(recordId: string, signal?: AbortSignal): Promise<ActivityItem[]> {
  return apiRequest("GET", `/api/v1/records/${recordId}/activity`, {
    guard: isActivityList,
    signal,
  });
}

export type Handover = { to_user_id: string; result: string; documents?: string };

/** Pass the task to someone who can already open the table (the version is sent as If-Match). */
export function handOver(recordId: string, version: number, body: Handover): Promise<RecordItem> {
  return apiRequest("POST", `/api/v1/records/${recordId}/handover`, {
    body,
    guard: isRecordItem,
    headers: { "If-Match": `"${version}"` },
  });
}

/** What happened, in words: "reported it as done". */
export const ACTION_TEXT: Record<ActivityAction, string> = {
  created: "created the task",
  updated: "changed",
  submitted: "reported it as done",
  approved: "approved it",
  sent_back: "sent it back",
  timer_started: "started the timer",
  timer_stopped: "stopped the timer",
  handed_over: "handed it over",
};
