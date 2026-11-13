"use client";

import { Check, RefreshCw, Send, Undo2, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Alert, Button, type ButtonProps } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { reviewRecord, type ReviewAction } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { reviewSteps } from "./taskWorkflow";

type Props = {
  fields: FieldItem[];
  record: RecordItem;
  currentUserId: string;
  onChanged: (record: RecordItem) => void;
  onReload: () => void;
};

const LOOK: Record<ReviewAction, { icon: LucideIcon; variant: ButtonProps["variant"] }> = {
  submit: { icon: Send, variant: "primary" },
  approve: { icon: Check, variant: "primary" },
  reject: { icon: Undo2, variant: "secondary" },
};

/** Report done, approve or send back: the buttons that fit this person and this task's status. */
export function ReviewActions({ fields, record, currentUserId, onChanged, onReload }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const steps = reviewSteps(fields, record, currentUserId);
  if (steps.length === 0) return null;

  async function run(action: ReviewAction) {
    setBusy(true);
    setMessage(null);
    try {
      onChanged(await reviewRecord(record.id, record.version, action));
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        setConflict(true);
        setMessage("Somebody else changed this task. Reload it and try again.");
      } else {
        setMessage(error instanceof ApiError ? error.message : "Could not update the task.");
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
            disabled={busy || conflict}
            onClick={() => void run(step.action)}
          >
            {step.label}
          </Button>
        ))}
      </div>
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
