"use client";

import { ListPlus } from "lucide-react";
import { useState } from "react";

import { Alert, Button, FormField, Input } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createRecord } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { assigneeIds, fieldBySemantic, titleField } from "./taskWorkflow";
import { UserPicker } from "./UserPicker";

type Props = {
  tableId: string;
  fields: FieldItem[];
  parent: RecordItem;
  currentUserId: string;
  canCreate: boolean;
  onCreated: (subtask: RecordItem) => void;
};

/**
 * "Add subtask": a record linked under this task. Editors can always add one; a department head
 * who was given the task can too (the backend checks that, this only decides what to offer).
 */
export function SubtaskForm({
  tableId,
  fields,
  parent,
  currentUserId,
  canCreate,
  onCreated,
}: Props) {
  const parentField = fieldBySemantic(fields, "parent");
  const nameField = titleField(fields);
  const assigneeField = fieldBySemantic(fields, "assignee");
  const mine = assigneeIds(fields, parent).includes(currentUserId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!parentField || !nameField || !(canCreate || mine)) return null;
  const parentFieldId = parentField.id;
  const nameFieldId = nameField.id;

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const data: Record<string, unknown> = {
        [parentFieldId]: [parent.id],
        [nameFieldId]: name.trim(),
      };
      if (assigneeField && assignees.length > 0) data[assigneeField.id] = assignees;
      const created = await createRecord(tableId, data);
      setName("");
      setAssignees([]);
      setOpen(false);
      onCreated(created);
    } catch (error) {
      setMessage(
        error instanceof ApiError && error.status === 403
          ? "Only an editor, or a department head assigned to this task, can add subtasks."
          : error instanceof ApiError
            ? error.message
            : "Could not add the subtask.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button icon={ListPlus} onClick={() => setOpen(true)}>
          Add subtask
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void create(event)}
      className="grid gap-3 rounded-lg border border-line bg-surface-muted p-3"
      aria-label="Add subtask"
    >
      <FormField label="Subtask name">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={500}
          required
        />
      </FormField>
      {assigneeField && (
        <div className="grid gap-1">
          <span className="text-sm font-medium">Assign to</span>
          <UserPicker label="Assign to" value={assignees} onChange={setAssignees} multiple />
        </div>
      )}
      {message && <Alert>{message}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy || name.trim() === ""}>
          {busy ? "Adding…" : "Create subtask"}
        </Button>
        <Button onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
