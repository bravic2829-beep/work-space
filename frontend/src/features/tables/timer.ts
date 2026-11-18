import type { FieldItem, RecordItem } from "./schema";
import { assigneeIds } from "./taskWorkflow";

export type TimerPhase = "idle" | "running" | "stopped";

export type TimerState = {
  phase: TimerPhase;
  /** Milliseconds since 1970, or null while the timer has not started / stopped. */
  startedAt: number | null;
  stoppedAt: number | null;
};

/** The timer columns of a table (a table may have several), in column order. */
export function timerColumns(fields: FieldItem[]): FieldItem[] {
  return fields.filter(isTimerField);
}

export function isTimerField(field: FieldItem): boolean {
  return field.type === "timer";
}

function moment(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** What one timer cell holds: {"started_at", "finished_at"}, either of which may be missing. */
function cellMoments(value: unknown): { startedAt: number | null; stoppedAt: number | null } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { startedAt: null, stoppedAt: null };
  }
  const cell = value as Record<string, unknown>;
  return { startedAt: moment(cell.started_at), stoppedAt: moment(cell.finished_at) };
}

/** The state of one timer column of a record. */
export function timerState(field: FieldItem, record: RecordItem): TimerState {
  const { startedAt, stoppedAt } = cellMoments(record.data[field.id]);
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

/** When a timer cell started and finished, ready to show ("" for a moment that has not come). */
export function timerMoments(value: unknown): { started: string; finished: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { started: "", finished: "" };
  }
  const cell = value as Record<string, unknown>;
  return { started: formatMoment(cell.started_at), finished: formatMoment(cell.finished_at) };
}

/** One timer cell in words, for lists and the history: "Nov 14, 08:00 → Nov 14, 09:30 (1:30:05)". */
export function describeTimer(value: unknown): string {
  const { startedAt, stoppedAt } = cellMoments(value);
  if (startedAt === null) return "";
  const started = formatMoment(new Date(startedAt).toISOString());
  if (stoppedAt === null) return `${started} → running`;
  const finished = formatMoment(new Date(stoppedAt).toISOString());
  return `${started} → ${finished} (${formatDuration(stoppedAt - startedAt)})`;
}

/**
 * The three columns a timer is drawn as. With one timer they are plain ("Started at"); with
 * several each one is prefixed by the name of its column so they can be told apart.
 */
export function timerHeadings(
  field: FieldItem,
  fields: FieldItem[],
): { started: string; finished: string; time: string } {
  const prefix = timerColumns(fields).length > 1 ? `${field.name} · ` : "";
  return {
    started: `${prefix}Started at`,
    finished: `${prefix}Finished at`,
    time: `${prefix}Time`,
  };
}

export type TimerRights = { start: boolean; stop: boolean };

/**
 * The buttons this person may press. The backend decides for real; this only avoids offering a
 * button that is certain to be refused. The person who gave the task (or an admin) starts the
 * clock; an assignee, that person or an admin stops it.
 */
export function timerRights(
  fields: FieldItem[],
  field: FieldItem,
  record: RecordItem,
  currentUserId: string,
  isAdmin: boolean,
): TimerRights {
  const { phase } = timerState(field, record);
  const giver = record.created_by === currentUserId || isAdmin;
  return {
    start: phase === "idle" && giver,
    stop: phase === "running" && (giver || assigneeIds(fields, record).includes(currentUserId)),
  };
}
