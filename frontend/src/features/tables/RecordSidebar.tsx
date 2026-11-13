"use client";

import { Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useState } from "react";

import { Alert, Button } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createRecord, deleteRecord, updateRecord } from "./api";
import { CommentsPanel } from "./CommentsPanel";
import { FieldEditor } from "./FieldEditor";
import { ReviewActions } from "./ReviewActions";
import type { FieldItem, RecordItem } from "./schema";
import { SubtaskForm } from "./SubtaskForm";
import { useUserNames } from "./useUserNames";
import {
  canEditField,
  changesFor,
  draftFromValue,
  isComputed,
  userIdsIn,
  type Draft,
} from "./values";

type Props = {
  tableId: string;
  fields: FieldItem[];
  /** The record being looked at, or null to write a new one. */
  record: RecordItem | null;
  currentUserId: string;
  canCreate: boolean;
  onSaved: (record: RecordItem, created: boolean) => void;
  onDeleted: (id: string) => void;
  onReload: () => void;
  onClose: () => void;
  /** A subtask was added under this record (the list may want to reload). */
  onSubtaskCreated?: (subtask: RecordItem) => void;
};

function initialDrafts(fields: FieldItem[], record: RecordItem | null): Record<string, Draft> {
  const drafts: Record<string, Draft> = {};
  for (const field of fields) drafts[field.id] = draftFromValue(field, record?.data[field.id]);
  return drafts;
}

/** The side panel of one record, like a Notion page: every visible column, editable if allowed. */
export function RecordSidebar({
  tableId,
  fields,
  record,
  currentUserId,
  canCreate,
  onSaved,
  onDeleted,
  onReload,
  onClose,
  onSubtaskCreated,
}: Props) {
  // The parent gives this component a new key per record and version, so the drafts start fresh.
  const [drafts, setDrafts] = useState(() => initialDrafts(fields, record));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const names = useUserNames(userIdsIn(fields, record ? [record] : []));

  const isNew = record === null;
  const shown = fields.filter((field) => !(isNew && isComputed(field)));
  const editable = shown.some(canEditField);
  const isCreator = record?.created_by === currentUserId;
  const { changes } = changesFor(fields, record, drafts);
  const dirty = Object.keys(changes).length > 0;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const checked = changesFor(fields, record, drafts);
    setErrors(checked.errors);
    setMessage(null);
    if (Object.keys(checked.errors).length > 0) return;
    if (Object.keys(checked.changes).length === 0 && !isNew) return;

    setBusy(true);
    try {
      const saved = record
        ? await updateRecord(record.id, record.version, checked.changes)
        : await createRecord(tableId, checked.changes);
      onSaved(saved, isNew);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setMessage("Could not save the record.");
      } else if (error.status === 412) {
        setConflict(true);
        setMessage("Somebody else changed this record while you were editing it.");
      } else {
        setMessage(error.message);
        const byField: Record<string, string> = {};
        for (const item of error.fieldErrors) byField[item.field] = item.message;
        setErrors(byField);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!record || !window.confirm("Move this record to the trash?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteRecord(record.id);
      onDeleted(record.id);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Could not delete the record.");
    } finally {
      setBusy(false);
    }
  }

  if (isNew && !canCreate) {
    return (
      <aside className="sidebar" aria-label="Record">
        <Alert>You do not have permission to add records to this table.</Alert>
        <Button className="mt-3" onClick={onClose}>
          Close
        </Button>
      </aside>
    );
  }

  return (
    <aside className="sidebar" aria-label="Record">
      <header>
        <h2>{isNew ? "New record" : "Record"}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the record">
          <X className="size-4" aria-hidden />
        </Button>
      </header>
      <form onSubmit={(event) => void save(event)} className="stack">
        {shown.map((field) => (
          <FieldEditor
            key={field.id}
            field={field}
            draft={drafts[field.id] ?? ""}
            value={record?.data[field.id]}
            names={names}
            disabled={busy || !canEditField(field)}
            error={errors[field.id]}
            onChange={(draft) => setDrafts((current) => ({ ...current, [field.id]: draft }))}
          />
        ))}
        {message && <Alert>{message}</Alert>}
        {conflict && (
          <Button icon={RefreshCw} onClick={onReload}>
            Reload the latest version
          </Button>
        )}
        {editable && !conflict && (
          <Button
            type="submit"
            variant="primary"
            icon={isNew ? Plus : Save}
            disabled={busy || (!isNew && !dirty)}
          >
            {busy ? "Saving…" : isNew ? "Create record" : "Save changes"}
          </Button>
        )}
        {!editable && !isNew && (
          <p className="text-sm text-muted">You can read this record but not change it.</p>
        )}
        {record && isCreator && (
          <Button variant="ghost" icon={Trash2} onClick={() => void remove()} disabled={busy}>
            Delete record
          </Button>
        )}
      </form>
      {record && (
        <div className="mt-5 grid gap-5 border-t border-line pt-5">
          <ReviewActions
            fields={fields}
            record={record}
            currentUserId={currentUserId}
            onChanged={(updated) => onSaved(updated, false)}
            onReload={onReload}
          />
          <SubtaskForm
            tableId={tableId}
            fields={fields}
            parent={record}
            currentUserId={currentUserId}
            canCreate={canCreate}
            onCreated={(subtask) => onSubtaskCreated?.(subtask)}
          />
          <CommentsPanel recordId={record.id} currentUserId={currentUserId} />
        </div>
      )}
    </aside>
  );
}
