"use client";

import { Play, Timer } from "lucide-react";

import { Avatar, plainName } from "@/components/ui";
import { dueInfo, daysLate, localToday } from "@/features/mytasks/schema";
import { formatShortDay } from "@/lib/format";
import { useNow } from "@/lib/useNow";

import { ReviewActions } from "./ReviewActions";
import type { FieldItem, RecordItem } from "./schema";
import { StatusStepper } from "./StatusStepper";
import { assigneeIds, fieldBySemantic, statusKind } from "./taskWorkflow";
import { elapsedMs, formatDuration, timerColumns, timerState } from "./timer";

type MetaProps = { fields: FieldItem[]; record: RecordItem; names: ReadonlyMap<string, string> };

/** The first timer of the task as a read-only clock: running, or the time it took. */
function Clock({ fields, record }: Pick<MetaProps, "fields" | "record">) {
  const timer = timerColumns(fields)[0];
  const state = timer ? timerState(timer, record) : null;
  const now = useNow(state?.phase === "running");
  if (!state || state.phase === "idle") return null;
  const Icon = state.phase === "running" ? Play : Timer;
  return (
    <span
      role="timer"
      aria-label={state.phase === "running" ? "Time running" : "Time spent"}
      className={
        state.phase === "running"
          ? "inline-flex items-center gap-1 font-mono text-primary"
          : "inline-flex items-center gap-1 font-mono"
      }
    >
      <Icon className="size-3" aria-hidden />
      {formatDuration(elapsedMs(state, now))}
    </span>
  );
}

/** Who has the task, when it is due and the time on it, in one line. */
function Meta({ fields, record, names }: MetaProps) {
  const people = assigneeIds(fields, record).map((id) => plainName(names.get(id) ?? "…"));
  const dueField = fieldBySemantic(fields, "due_date");
  const due = dueField ? record.data[dueField.id] : undefined;
  const today = localToday();
  const info =
    typeof due === "string" && due !== "" && statusKind(fields, record) !== "done"
      ? dueInfo(due, today)
      : null;

  const parts: React.ReactNode[] = [];
  if (people.length > 0) {
    parts.push(
      <span key="who" className="inline-flex items-center gap-1.5">
        <Avatar name={people[0]} className="size-5 text-[10px]" />
        {people[0]}
        {people.length > 1 && ` +${people.length - 1}`}
      </span>,
    );
  }
  if (typeof due === "string" && due !== "") {
    parts.push(<span key="due">due {formatShortDay(due)}</span>);
    if (info?.tone === "overdue") {
      const days = daysLate(due, today);
      parts.push(
        <span key="late" className="font-semibold text-danger">
          {days} {days === 1 ? "day" : "days"} late
        </span>,
      );
    } else if (info?.tone === "today") {
      parts.push(
        <span key="today" className="font-semibold text-primary">
          today
        </span>,
      );
    }
  }
  parts.push(<Clock key="clock" fields={fields} record={record} />);

  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
      {parts.flatMap((part, index) =>
        index === 0
          ? [part]
          : [
              <span key={`dot-${index}`} aria-hidden>
                ·
              </span>,
              part,
            ],
      )}
    </p>
  );
}

type Props = MetaProps & {
  currentUserId: string;
  reviewer: boolean;
  admin: boolean;
  onChanged: (record: RecordItem) => void;
  onReload: () => void;
};

/**
 * The top of a task panel, always in view: where the task is, who has it and when it is due, and
 * the review step that fits the person (report as done, approve, send back).
 */
export function TaskSummary({
  fields,
  record,
  names,
  currentUserId,
  reviewer,
  admin,
  onChanged,
  onReload,
}: Props) {
  return (
    <div className="grid gap-2.5 border-b border-line px-4 py-3">
      <StatusStepper fields={fields} record={record} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Meta fields={fields} record={record} names={names} />
        <ReviewActions
          fields={fields}
          record={record}
          currentUserId={currentUserId}
          reviewer={reviewer}
          admin={admin}
          onChanged={onChanged}
          onReload={onReload}
        />
      </div>
    </div>
  );
}
