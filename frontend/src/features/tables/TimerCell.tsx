"use client";

import { Play, Square } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

import { timerRecord, type TimerAction } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { elapsedMs, formatDuration, timerRights, timerState } from "./timer";
import { errorMessage, hasStatus } from "@/lib/api/errors";
import { useAsyncAction } from "@/lib/useAsyncAction";
import { useNow } from "@/lib/useNow";

type Props = {
  /** All the columns of the table (who is assigned is read from them). */
  fields: FieldItem[];
  /** The timer column this cell belongs to. */
  field: FieldItem;
  record: RecordItem;
  currentUserId: string;
  isAdmin: boolean;
  /** What to show when the timer has not started and the person cannot start it. */
  idle?: React.ReactNode;
  onChanged: (record: RecordItem) => void;
};

/**
 * The task timer of one record: a Start button for the person who gave the task, the time running
 * while the work is done, a Stop button for the assignee, and the time spent in the end.
 */
export function TimerCell({
  fields,
  field,
  record,
  currentUserId,
  isAdmin,
  idle = <span className="text-muted">Not started</span>,
  onChanged,
}: Props) {
  const state = timerState(field, record);
  const rights = timerRights(fields, field, record, currentUserId, isAdmin);
  const now = useNow(state.phase === "running");
  const { busy, message, run } = useAsyncAction();

  const press = (action: TimerAction) =>
    run(
      async () => {
        onChanged(await timerRecord(record.id, record.version, action, field.id));
      },
      (error) =>
        hasStatus(error, 412)
          ? "Somebody else changed this task. Reload the page."
          : errorMessage(error, "Could not change the timer."),
    );

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {state.phase === "idle" && !rights.start && idle}
      {state.phase !== "idle" && (
        <span
          role="timer"
          aria-label={state.phase === "running" ? "Time running" : "Time spent"}
          className={cn(
            "inline-flex items-center gap-1.5 font-mono text-[13px] font-semibold",
            state.phase === "running" ? "text-primary" : "text-success",
          )}
        >
          {state.phase === "running" && (
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-primary" />
          )}
          {formatDuration(elapsedMs(state, now))}
        </span>
      )}
      {rights.start && (
        <Button
          size="sm"
          variant="primary"
          icon={Play}
          disabled={busy}
          onClick={() => void press("start")}
        >
          Start
        </Button>
      )}
      {rights.stop && (
        <Button size="sm" variant="secondary" icon={Square} disabled={busy} onClick={() => void press("stop")}>
          Stop
        </Button>
      )}
      {message && (
        <span role="alert" className="w-full text-xs text-danger">
          {message}
        </span>
      )}
    </span>
  );
}
