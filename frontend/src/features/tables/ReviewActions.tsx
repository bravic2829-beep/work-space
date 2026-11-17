"use client";

import {
  Check,
  OctagonAlert,
  Pause,
  Play,
  RefreshCw,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { Alert, Button, Textarea, type ButtonProps } from "@/components/ui";

import { reviewRecord, type ReviewAction } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { holdSteps, reviewSteps } from "./taskWorkflow";
import { errorMessage, hasStatus } from "@/lib/api/errors";
import { useAsyncAction } from "@/lib/useAsyncAction";

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
  pause: { icon: Pause, variant: "secondary" },
  block: { icon: OctagonAlert, variant: "secondary" },
  resume: { icon: Play, variant: "primary" },
};

/** The actions that need a reason, with the words the box and its button use. */
const WHY: Partial<
  Record<ReviewAction, { question: string; hint: string; send: string; icon: LucideIcon }>
> = {
  reject: {
    question: "What needs to change?",
    hint: "For example: add the refunds of October before sending it again.",
    send: "Send back with this reason",
    icon: Undo2,
  },
  block: {
    question: "What is blocking this task?",
    hint: "For example: waiting for the price list from the supplier.",
    send: "Report this blocker",
    icon: OctagonAlert,
  },
};

/**
 * The buttons that fit this person and this task's status: report done, approve, send back, and
 * pause, report a blocker or resume. Sending back and reporting a blocker ask for a reason; it
 * reaches the people concerned as a comment.
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
  const { busy, message, run: execute } = useAsyncAction();
  const [conflict, setConflict] = useState(false);
  const [asking, setAsking] = useState<ReviewAction | null>(null);
  const [reason, setReason] = useState("");

  const steps = [
    ...reviewSteps(fields, record, currentUserId, reviewer, admin),
    ...holdSteps(fields, record, currentUserId, reviewer, admin),
  ];
  if (steps.length === 0) return null;

  const run = (action: ReviewAction) =>
    execute(
      async () => {
        const updated =
          WHY[action] !== undefined
            ? await reviewRecord(record.id, record.version, action, reason.trim())
            : await reviewRecord(record.id, record.version, action);
        setAsking(null);
        setReason("");
        onChanged(updated);
      },
      (error) => {
        if (hasStatus(error, 412)) {
          setConflict(true);
          return "Somebody else changed this task. Reload it and try again.";
        }
        // The reason stays in the box, so nothing typed is lost.
        return errorMessage(error, "Could not update the task.");
      },
    );

  const why = asking ? WHY[asking] : undefined;

  return (
    <section aria-label="Review" className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <Button
            key={step.action}
            variant={LOOK[step.action].variant}
            icon={LOOK[step.action].icon}
            disabled={busy || conflict || asking === step.action}
            onClick={() => {
              if (WHY[step.action] !== undefined) setAsking(step.action);
              else {
                setAsking(null);
                void run(step.action);
              }
            }}
          >
            {step.label}
          </Button>
        ))}
      </div>
      {asking && why && (
        <form
          className="grid gap-2 rounded-md border border-line bg-surface-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(asking);
          }}
        >
          <label className="grid gap-1 text-sm font-medium">
            {why.question}
            <Textarea
              rows={3}
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              placeholder={why.hint}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              icon={why.icon}
              disabled={busy || reason.trim() === ""}
            >
              {why.send}
            </Button>
            <Button onClick={() => setAsking(null)} disabled={busy}>
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
