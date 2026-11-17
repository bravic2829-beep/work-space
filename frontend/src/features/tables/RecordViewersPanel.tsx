"use client";

import { Eye, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, Avatar, Badge, Button, LoadingState, type Tone } from "@/components/ui";

import { getRecordViewers, updateRecord } from "./api";
import type { FieldItem, RecordItem, RecordViewers, ViewerReason } from "./schema";
import { fieldBySemantic } from "./taskWorkflow";
import { UserPicker } from "./UserPicker";
import { canEditField } from "./values";
import { errorMessage, hasStatus } from "@/lib/api/errors";

type Props = {
  fields: FieldItem[];
  record: RecordItem;
  /** The record changed (a person was added or removed): the parent shows the new version. */
  onChanged: (record: RecordItem) => void;
};

const REASON_LABEL: Record<ViewerReason, string> = {
  creator: "Created it",
  assignee: "Assigned",
  follower: "Can view",
  field: "Named on it",
  sheet: "On the sheet",
};

const REASON_TONE: Record<ViewerReason, Tone> = {
  creator: "neutral",
  assignee: "info",
  follower: "success",
  field: "neutral",
  sheet: "neutral",
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; viewers: RecordViewers };

function followerIds(field: FieldItem, record: RecordItem): string[] {
  const value = record.data[field.id];
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * "Who can see this task": the people named on it and why, the workspace that sees it too, and
 * (for somebody allowed to edit the Follower column) a way to let one more person see it or to
 * take that away. The backend decides who sees what; this only shows its answer.
 */
export function RecordViewersPanel({ fields, record, onChanged }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const follower = fieldBySemantic(fields, "follower");
  const canShare = follower !== undefined && canEditField(follower);

  useEffect(() => {
    const controller = new AbortController();
    getRecordViewers(record.id, controller.signal)
      .then((viewers) => setState({ kind: "ready", viewers }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [record.id, record.version]);

  async function setFollowers(next: string[]) {
    if (!follower) return;
    setBusy(true);
    setMessage(null);
    try {
      onChanged(await updateRecord(record.id, record.version, { [follower.id]: next }));
    } catch (error) {
      setMessage(
        hasStatus(error, 412)
          ? "Somebody else changed this task. Close it and open it again."
          : errorMessage(error, "Could not change who can see this task."),
      );
    } finally {
      setBusy(false);
    }
  }

  const current = follower ? followerIds(follower, record) : [];

  return (
    <section aria-label="Who can see this task" className="grid gap-2">
      <h3 className="m-0 flex items-center gap-1.5 text-sm">
        <Eye className="size-4 text-muted" aria-hidden />
        Who can see this task
      </h3>
      {state.kind === "loading" && <LoadingState>Loading…</LoadingState>}
      {state.kind === "error" && (
        <p className="m-0 text-sm text-muted">Could not load who can see this task.</p>
      )}
      {state.kind === "ready" && (
        <>
          <ul aria-label="People who can see this task" className="m-0 grid list-none gap-1 p-0">
            {state.viewers.people.map((person) => {
              const removable = canShare && person.reasons.includes("follower");
              return (
                <li
                  key={person.user_id}
                  className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
                >
                  <Avatar name={person.full_name} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[13px] font-medium">{person.full_name}</span>
                    <span className="truncate font-mono text-[11px] text-muted">
                      {person.employee_code}
                    </span>
                  </span>
                  {person.reasons.map((reason) => (
                    <Badge key={reason} tone={REASON_TONE[reason]}>
                      {REASON_LABEL[reason]}
                    </Badge>
                  ))}
                  {removable && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={busy}
                      aria-label={`Stop ${person.full_name} from seeing this task`}
                      title="Remove access"
                      onClick={() =>
                        void setFollowers(current.filter((id) => id !== person.user_id))
                      }
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="m-0 text-xs text-muted">
            Everyone in “{state.viewers.workspace_name}” ({state.viewers.workspace_member_count}{" "}
            {state.viewers.workspace_member_count === 1 ? "person" : "people"}) can see it too.
            People listed here can open it even if they are not in the workspace.
          </p>
        </>
      )}
      {canShare && state.kind === "ready" && (
        <div className="grid gap-1">
          <span className="text-sm font-medium">Let someone else see it</span>
          <UserPicker
            label="Let someone see this task"
            value={[]}
            onChange={(ids) => void setFollowers([...new Set([...current, ...ids])])}
            multiple
            disabled={busy}
          />
        </div>
      )}
      {message && <Alert>{message}</Alert>}
    </section>
  );
}
