"use client";

import { ArrowRightLeft } from "lucide-react";
import { useState } from "react";

import { Alert, Button, FormField, Input, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { handOver } from "./activity";
import type { RecordItem } from "./schema";
import { UserPicker } from "./UserPicker";

type Props = {
  record: RecordItem;
  onChanged: (record: RecordItem) => void;
};

/**
 * "Hand over": give the task to somebody else, saying what was done and which documents go with
 * it. The person must already be able to open the table; the server says so if not.
 */
export function HandoverForm({ record, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const [documents, setDocuments] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <div>
        <Button icon={ArrowRightLeft} onClick={() => setOpen(true)}>
          Hand over
        </Button>
      </div>
    );
  }

  const ready = to.length === 1 && result.trim() !== "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setMessage(null);
    try {
      onChanged(
        await handOver(record.id, record.version, {
          to_user_id: to[0],
          result: result.trim(),
          ...(documents.trim() ? { documents: documents.trim() } : {}),
        }),
      );
    } catch (error) {
      // What was typed stays, so it can be sent again.
      setMessage(
        error instanceof ApiError && error.status === 412
          ? "Somebody else changed this task. Close it and open it again."
          : error instanceof ApiError
            ? error.message
            : "Could not hand the task over.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Hand over"
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-md border border-line bg-surface-muted p-3"
    >
      <h3 className="m-0 flex items-center gap-1.5 text-sm">
        <ArrowRightLeft className="size-4 text-muted" aria-hidden />
        Hand over
      </h3>
      <div className="grid gap-1">
        <span className="text-sm font-medium">To</span>
        <UserPicker label="Hand over to" value={to} onChange={setTo} multiple={false} />
      </div>
      <FormField label="What was done">
        <Textarea
          rows={3}
          value={result}
          maxLength={5000}
          onChange={(event) => setResult(event.target.value)}
          placeholder="What is finished, what is left, what to watch out for."
        />
      </FormField>
      <FormField label="Documents">
        <Input
          value={documents}
          maxLength={2000}
          onChange={(event) => setDocuments(event.target.value)}
          placeholder="File names or links"
        />
      </FormField>
      {message && <Alert>{message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon={ArrowRightLeft} disabled={busy || !ready}>
          Hand over
        </Button>
        <Button onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
