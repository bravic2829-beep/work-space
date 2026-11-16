"use client";

import { ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  FormField,
  Input,
  Textarea,
} from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createRecord } from "./api";
import type { FieldItem, RecordItem } from "./schema";
import { fieldBySemantic, titleField } from "./taskWorkflow";
import { UserPicker } from "./UserPicker";
import { useUserNames } from "./useUserNames";
import { canEditField } from "./values";

type Props = {
  tableId: string;
  fields: FieldItem[];
  /** A task was assigned. `assignee` is the label of the person ("Ann (A1)"). */
  onAssigned: (record: RecordItem, taskName: string, assignee: string) => void;
  onClose: () => void;
};

/** What this table needs for the form, or null when it cannot take assigned tasks. */
export function assignTargets(fields: FieldItem[]) {
  const name = titleField(fields);
  const assignee = fieldBySemantic(fields, "assignee");
  if (!name || !assignee || !canEditField(name) || !canEditField(assignee)) return null;
  const due = fieldBySemantic(fields, "due_date");
  const follower = fieldBySemantic(fields, "follower");
  const description = fields.find((f) => f.type === "long_text" && canEditField(f));
  return {
    name,
    assignee,
    due: due && canEditField(due) ? due : undefined,
    follower: follower && canEditField(follower) ? follower : undefined,
    description,
  };
}

/**
 * "Assign task": the short way to give work to somebody. Name and person are needed; the rest is
 * optional. The person can open the task even when they are not in the workspace, and so can
 * anybody added under "Who else can see it".
 */
export function AssignTaskDrawer({ tableId, fields, onAssigned, onClose }: Props) {
  const targets = assignTargets(fields);
  const [name, setName] = useState("");
  const [assignee, setAssignee] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [description, setDescription] = useState("");
  const [viewers, setViewers] = useState<string[]>([]);
  const [another, setAnother] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const names = useUserNames([...assignee, ...viewers]);

  if (!targets) {
    return (
      <Drawer open title="Assign a task" onClose={onClose}>
        <DrawerBody>
          <Alert tone="warning">
            This table has no Assignee column you can edit, so tasks cannot be assigned here.
          </Alert>
        </DrawerBody>
        <DrawerFooter>
          <Button onClick={onClose}>Close</Button>
        </DrawerFooter>
      </Drawer>
    );
  }
  const t = targets;
  const ready = name.trim() !== "" && assignee.length >= 1;
  // Someone who is both assignee and viewer is listed once, as the assignee.
  const viewOnly = viewers.filter((id) => !assignee.includes(id));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setMessage(null);
    try {
      const data: Record<string, unknown> = {
        [t.name.id]: name.trim(),
        [t.assignee.id]: assignee,
      };
      if (t.due && due) data[t.due.id] = due;
      if (t.description && description.trim()) data[t.description.id] = description.trim();
      if (t.follower && viewers.length > 0) data[t.follower.id] = viewers;
      const created = await createRecord(tableId, data);
      const who = assignee.map((id) => names.get(id) ?? "the assignee").join(", ");
      onAssigned(created, name.trim(), who);
      if (another) {
        setName("");
        setDue("");
        setDescription("");
        setViewers([]);
        // The person stays: several tasks for the same person is the usual case.
      } else {
        onClose();
      }
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? (error.fieldErrors[0]?.message ?? error.message)
          : "Could not assign the task.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open title="Assign a task" onClose={onClose} wide>
      <DrawerBody>
        <form
          id="assign-task-form"
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <FormField label="Task name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={500}
              placeholder="What needs to be done?"
              required
            />
          </FormField>
          <div className="grid gap-1">
            <span className="text-sm font-medium">Assign to</span>
            <UserPicker label="Assign to" value={assignee} onChange={setAssignee} multiple />
          </div>
          {t.due && (
            <FormField label="Due date">
              <Input type="date" value={due} onChange={(event) => setDue(event.target.value)} />
            </FormField>
          )}
          {t.description && (
            <FormField label={t.description.name}>
              <Textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What result do you expect?"
              />
            </FormField>
          )}
          {t.follower && (
            <div className="grid gap-1">
              <span className="text-sm font-medium">Who else can see it</span>
              <UserPicker
                label="Who else can see it"
                value={viewers}
                onChange={setViewers}
                multiple
              />
              <p className="m-0 text-xs text-muted">
                The people above always can. Members of this workspace can see every task of the
                table too.
              </p>
            </div>
          )}
          {assignee.length > 0 && (
            <section aria-label="Who will have access" className="grid gap-1.5">
              <h3 className="m-0 flex items-center gap-1.5 text-sm">
                <ShieldCheck className="size-4 text-muted" aria-hidden />
                Who will have access
              </h3>
              <ul className="m-0 grid list-none gap-1 p-0">
                {assignee.map((id) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {names.get(id) ?? "…"}
                    </span>
                    <Badge tone="info">Assignee</Badge>
                    <span className="text-xs text-muted">Opens it, reports it done</span>
                  </li>
                ))}
                {viewOnly.map((id) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {names.get(id) ?? "…"}
                    </span>
                    <Badge tone="success">Can view</Badge>
                    <span className="text-xs text-muted">Read only</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {message && <Alert>{message}</Alert>}
        </form>
      </DrawerBody>
      <DrawerFooter>
        <Button
          type="submit"
          form="assign-task-form"
          variant="primary"
          icon={UserPlus}
          loading={busy}
          disabled={!ready}
        >
          Assign task
        </Button>
        <label className="ml-auto flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={another}
            onChange={(event) => setAnother(event.target.checked)}
          />
          Assign another
        </label>
      </DrawerFooter>
    </Drawer>
  );
}
