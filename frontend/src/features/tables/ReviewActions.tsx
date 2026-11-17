"use client";

import { Check, RefreshCw, Send, Undo2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Alert, Button, Textarea, type ButtonProps } from "@/components/ui";

import { reviewRecord, type ReviewAction } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { reviewSteps } from "./taskWorkflow";
import { errorMessage, hasStatus } from "@/lib/api/errors";

type Props = {
  fields: FieldItem[];
  record: RecordItem;
  currentUserId: string;
  /** The person may approve or send back although they did not create the task. */
  reviewer?: boolean;
  /** An organization admin, who may do every step for anybody. */
  admin?: boolean;
  onChanged: (record: RecordItem) => void;
  onReload: () => void;
};

const LOOK: Record<ReviewAction, { icon: LucideIcon; variant: ButtonProps["variant"] }> = {
  submit: { icon: Send, variant: "primary" },
  approve: { icon: Check, variant: "primary" },
  reject: { icon: Undo2, variant: "secondary" },
};

/**
 * Report done, approve or send back: the buttons that fit this person and this task's status.
 * Sending back asks what needs to change; the reason reaches the assignee as a comment.
 */
export function ReviewActions({
  fields,
  record,
  currentUserId,
  reviewer = false,
  admin = false,
  onChanged,
  onReload,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const steps = reviewSteps(fields, record, currentUserId, reviewer, admin);
  if (steps.length === 0) return null;

  async function run(action: ReviewAction) {
    setBusy(true);
    setMessage(null);
    try {
      onChanged(
        action === "reject"
          ? await reviewRecord(record.id, record.version, action, reason.trim())
          : await reviewRecord(record.id, record.version, action),
      );
    } catch (error) {
      if (hasStatus(error, 412)) {
        setConflict(true);
        setMessage("Somebody else changed this task. Reload it and try again.");
      } else {
        // The reason stays in the box, so nothing typed is lost.
        setMessage(errorMessage(error, "Could not update the task."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Review" className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <Button
            key={step.action}
            variant={LOOK[step.action].variant}
            icon={LOOK[step.action].icon}
            disabled={busy || conflict || (asking && step.action === "reject")}
            onClick={() => (step.action === "reject" ? setAsking(true) : void run(step.action))}
          >
            {step.label}
          </Button>
        ))}
      </div>
      {asking && (
        <form
          className="grid gap-2 rounded-md border border-line bg-surface-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run("reject");
          }}
        >
          <label className="grid gap-1 text-sm font-medium">
            What needs to change?
            <Textarea
              rows={3}
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: add the refunds of October before sending it again."
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              icon={Undo2}
              disabled={busy || reason.trim() === ""}
            >
              Send back with this reason
            </Button>
            <Button onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {message && <Alert>{message}</Alert>}
      {conflict && (
        <div>
          <Button icon={RefreshCw} onClick={onReload}>
            Reload the latest version
          </Button>
        </div>
      )}
    </section>
  );
}
