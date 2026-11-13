"use client";

import { useState } from "react";

import { ApiError } from "@/lib/api/client";

import { createRecord, deleteRecord, updateRecord } from "./api";
import { FieldEditor } from "./FieldEditor";
import type { FieldItem, RecordItem } from "./schema";
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
        <p role="alert">You do not have permission to add records to this table.</p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar" aria-label="Record">
      <header>
        <h2>{isNew ? "New record" : "Record"}</h2>
        <button type="button" onClick={onClose} aria-label="Close the record">
          ×
        </button>
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
        {message && <p role="alert">{message}</p>}
        {conflict && (
          <button type="button" onClick={onReload}>
            Reload the latest version
          </button>
        )}
        {editable && !conflict && (
          <button type="submit" disabled={busy || (!isNew && !dirty)}>
            {busy ? "Saving…" : isNew ? "Create record" : "Save changes"}
          </button>
        )}
        {!editable && !isNew && <p>You can read this record but not change it.</p>}
        {record && isCreator && (
          <button type="button" onClick={() => void remove()} disabled={busy}>
            Delete record
          </button>
        )}
      </form>
    </aside>
  );
}
