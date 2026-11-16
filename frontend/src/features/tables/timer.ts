import type { FieldItem, RecordItem } from "./schema";
import { assigneeIds, fieldBySemantic } from "./taskWorkflow";

export type TimerPhase = "idle" | "running" | "stopped";

export type TimerState = {
  phase: TimerPhase;
  /** Milliseconds since 1970, or null while the timer has not started / stopped. */
  startedAt: number | null;
  stoppedAt: number | null;
};

/** The two columns of the task timer, or null when the table has no timer. */
export function timerFields(fields: FieldItem[]): { start: FieldItem; stop: FieldItem } | null {
  const start = fieldBySemantic(fields, "timer_start");
  const stop = fieldBySemantic(fields, "timer_stop");
  return start && stop ? { start, stop } : null;
}

export function isTimerField(field: FieldItem): boolean {
  return field.semantic === "timer_start" || field.semantic === "timer_stop";
}

function moment(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function timerState(fields: FieldItem[], record: RecordItem): TimerState {
  const columns = timerFields(fields);
  const startedAt = columns ? moment(record.data[columns.start.id]) : null;
  const stoppedAt = columns ? moment(record.data[columns.stop.id]) : null;
  if (startedAt === null) return { phase: "idle", startedAt: null, stoppedAt: null };
  if (stoppedAt === null) return { phase: "running", startedAt, stoppedAt: null };
  return { phase: "stopped", startedAt, stoppedAt };
}

/** The time spent so far (running) or in the end (stopped). Never negative. */
export function elapsedMs(state: TimerState, now: number): number {
  if (state.startedAt === null) return 0;
  return Math.max(0, (state.stoppedAt ?? now) - state.startedAt);
}

/** "0:05:09", "12:30:00": hours, minutes, seconds. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** A moment in the reader's time zone: "Nov 14, 09:12". */
export function formatMoment(value: unknown): string {
  const time = moment(value);
  if (time === null) return "";
  return new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export type TimerRights = { start: boolean; stop: boolean };

/**
 * The buttons this person may press. The backend decides for real; this only avoids offering a
 * button that is certain to be refused. The person who gave the task (or an admin) starts the
 * clock; an assignee, that person or an admin stops it.
 */
export function timerRights(
  fields: FieldItem[],
  record: RecordItem,
  currentUserId: string,
  isAdmin: boolean,
): TimerRights {
  const { phase } = timerState(fields, record);
  const giver = record.created_by === currentUserId || isAdmin;
  return {
    start: phase === "idle" && giver,
    stop: phase === "running" && (giver || assigneeIds(fields, record).includes(currentUserId)),
  };
}
