"use client";

import { History } from "lucide-react";
import { useMemo } from "react";

import { LoadingState } from "@/components/ui";
import { useApiResource } from "@/lib/useApiResource";

import { ACTION_TEXT, listActivity, type ActivityChange, type ActivityItem } from "./activity";
import type { FieldItem } from "./schema";
import { useUserNames } from "./useUserNames";
import { displayValue } from "./values";

type Props = {
  recordId: string;
  /** Changes when the task changes, so the history is asked for again. */
  version: number;
  fields: FieldItem[];
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function userIds(items: ActivityItem[], fields: FieldItem[]): string[] {
  const people = new Set(fields.filter((f) => f.type === "user").map((f) => f.id));
  const ids: string[] = [];
  for (const item of items) {
    for (const change of item.changes) {
      if (!people.has(change.field_id)) continue;
      for (const side of [change.before, change.after]) {
        if (Array.isArray(side)) ids.push(...side.filter((v): v is string => typeof v === "string"));
      }
    }
  }
  return ids;
}

/** "History": who did what to the task, newest first, in words. */
export function ActivityPanel({ recordId, version, fields }: Props) {
  const state = useApiResource(
    (signal) => listActivity(recordId, signal),
    "Could not load the history of this task.",
    [recordId, version],
  );

  const items = useMemo(() => (state.kind === "ready" ? state.data : []), [state]);
  const names = useUserNames(userIds(items, fields));
  const byId = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  function value(change: ActivityChange, side: unknown): string {
    const field = byId.get(change.field_id);
    if (side === null || side === undefined || side === "") return "empty";
    if (!field || field.type === "attachment") {
      return typeof side === "string" ? side : JSON.stringify(side);
    }
    if (field.type === "link_record") return Array.isArray(side) ? `${side.length} linked` : "linked";
    return displayValue(field, side, names) || "empty";
  }

  return (
    <section aria-label="History" className="grid gap-2">
      <h3 className="m-0 flex items-center gap-1.5 text-sm">
        <History className="size-4 text-muted" aria-hidden />
        History
      </h3>
      {state.kind === "loading" && <LoadingState>Loading…</LoadingState>}
      {state.kind === "error" && (
        <p className="m-0 text-sm text-muted">Could not load the history of this task.</p>
      )}
      {state.kind === "ready" && items.length === 0 && (
        <p className="m-0 text-sm text-muted">Nothing has happened yet.</p>
      )}
      {state.kind === "ready" && items.length > 0 && (
        <ol aria-label="History of this task" className="m-0 grid list-none gap-2 p-0">
          {items.map((item) => (
            <li key={item.id} className="border-l-2 border-line pl-3 text-[13px]">
              <div>
                <b className="font-semibold">{item.actor.full_name}</b> {ACTION_TEXT[item.action]}
                <span className="ml-2 text-xs text-muted">{when(item.created_at)}</span>
              </div>
              {item.action !== "created" && item.changes.length > 0 && (
                <ul className="m-0 mt-0.5 list-none p-0 text-muted">
                  {item.changes.map((change) => (
                    <li key={change.field_id}>
                      {change.field_name}: {value(change, change.before)} →{" "}
                      <span className="text-fg">{value(change, change.after)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {item.note && (
                <p className="m-0 mt-1 rounded bg-surface-muted px-2 py-1 whitespace-pre-line">
                  {item.note}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
