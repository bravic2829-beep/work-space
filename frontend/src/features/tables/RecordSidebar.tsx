"use client";

import { Plus, RefreshCw, Save, Timer } from "lucide-react";
import { useState } from "react";

import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  InlineConfirm,
  Tabs,
} from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { createRecord, deleteRecord, updateRecord } from "./api";
import { ActivityPanel } from "./ActivityPanel";
import { AttachmentsField } from "./AttachmentsField";
import { CommentsPanel } from "./CommentsPanel";
import { FieldEditor } from "./FieldEditor";
import { HandoverForm } from "./HandoverForm";
import { RecordViewersPanel } from "./RecordViewersPanel";
import type { FieldItem, RecordItem } from "./schema";
import { SubtaskForm } from "./SubtaskForm";
import { assigneeIds, fieldBySemantic, titleField } from "./taskWorkflow";
import { isTimerField, timerColumns } from "./timer";
import { TimerCell } from "./TimerCell";
import { RECORD_TABS, type RecordTab } from "./recordTabs";
import { TaskSummary } from "./TaskSummary";
import { useUserNames } from "./useUserNames";
import {
  canEditField,
  changesFor,
  displayValue,
  draftFromValue,
  isComputed,
  newRecordDraft,
  userIdsIn,
  type Draft,
} from "./values";
import { errorMessage } from "@/lib/api/errors";

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
  /** An organization admin may press Start and Stop on any task. */
  isAdmin?: boolean;
  /** Writes a new record somewhere else than the table (a sheet adds the task for its owner). */
  onCreate?: (data: Record<string, unknown>) => Promise<RecordItem>;
  /** The person reviews the work of this record (a manager of its sheet), not only its creator. */
  reviewer?: boolean;
  /**
   * An editor of the whole table (a workspace editor), who may hand any task over. Defaults to
   * `canCreate`; on a sheet, editing the sheet does not give that right.
   */
  tableEditor?: boolean;
  /** An organization admin: every right on every task (delete, review, comments). */
  admin?: boolean;
  /**
   * A new task is given to this person whatever the form says (the owner of the sheet it is added
   * on), so the form leaves out the people columns and says who gets it.
   */
  givenTo?: string;
  /**
   * The section of the panel that is open, and how to change it. The parent keeps it, because the
   * panel is made again after every change of the record. Without them the panel remembers it.
   */
  tab?: RecordTab;
  onTabChange?: (tab: RecordTab) => void;
};

const FORM_ID = "record-form";
const TABS_ID = "record";

function initialDrafts(fields: FieldItem[], record: RecordItem | null): Record<string, Draft> {
  const drafts: Record<string, Draft> = {};
  for (const field of fields) {
    drafts[field.id] = record ? draftFromValue(field, record.data[field.id]) : newRecordDraft(field);
  }
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
  isAdmin = false,
  onCreate,
  reviewer = false,
  tableEditor = canCreate,
  admin = false,
  givenTo,
  tab: tabFromParent,
  onTabChange,
}: Props) {
  const [ownTab, setOwnTab] = useState<RecordTab>("details");
  const tab = tabFromParent ?? ownTab;
  const setTab = onTabChange ?? setOwnTab;
  // The parent gives this component a new key per record and version, so the drafts start fresh.
  const [drafts, setDrafts] = useState(() => initialDrafts(fields, record));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const names = useUserNames(userIdsIn(fields, record ? [record] : []));

  const isNew = record === null;
  // A timer has its own section below (Start, Stop and the time), not an input.
  const timers = timerColumns(fields);
  const shown = fields.filter(
    (field) =>
      !isTimerField(field) &&
      !(isNew && isComputed(field)) &&
      !(isNew && givenTo !== undefined && (field.semantic === "assignee" || field.semantic === "follower")),
  );
  const editable = shown.some(canEditField);
  const isCreator = record?.created_by === currentUserId;
  // The server decides; this only hides a button that is certain to be refused.
  const canHandOver =
    record !== null &&
    fieldBySemantic(fields, "assignee") !== undefined &&
    (isCreator ||
      tableEditor ||
      isAdmin ||
      reviewer ||
      assigneeIds(fields, record).includes(currentUserId));
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
        : onCreate
          ? await onCreate(checked.changes)
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
    if (!record) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteRecord(record.id);
      onDeleted(record.id);
    } catch (error) {
      setMessage(errorMessage(error, "Could not delete the record."));
    } finally {
      setBusy(false);
    }
  }

  const title = "New record";

  if (isNew && !canCreate) {
    return (
      <Drawer open title={title} onClose={onClose}>
        <DrawerBody>
          <Alert>You do not have permission to add records to this table.</Alert>
        </DrawerBody>
        <DrawerFooter>
          <Button onClick={onClose}>Close</Button>
        </DrawerFooter>
      </Drawer>
    );
  }

  const showSave = editable && !conflict;
  const showDelete = record !== null && (isCreator || admin);

  const form = (
    <form id={FORM_ID} onSubmit={(event) => void save(event)} className="flex flex-col gap-3">
      {isNew && givenTo !== undefined && (
        <p className="m-0 text-sm text-muted">
          This task will be given to <strong className="text-fg">{givenTo}</strong>.
        </p>
      )}
      {shown.map((field) =>
        field.type === "attachment" ? (
          <AttachmentsField
            key={field.id}
            field={field}
            record={record}
            canEdit={field.access === "edit"}
            onChanged={(updated) => onSaved(updated, false)}
          />
        ) : (
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
        ),
      )}
      {message && <Alert>{message}</Alert>}
      {conflict && (
        <Button icon={RefreshCw} onClick={onReload}>
          Reload the latest version
        </Button>
      )}
      {!editable && !isNew && (
        <p className="m-0 text-sm text-muted">You can read this record but not change it.</p>
      )}
    </form>
  );

  const footer = (showSave || showDelete) && (
    <DrawerFooter>
      {showSave && (
        <Button
          type="submit"
          form={FORM_ID}
          variant="primary"
          icon={isNew ? Plus : Save}
          disabled={busy || (!isNew && !dirty)}
        >
          {busy ? "Saving…" : isNew ? "Create record" : "Save changes"}
        </Button>
      )}
      {showDelete && (
        <span className="ml-auto">
          <InlineConfirm
            label="Delete record"
            prompt="Delete this record for good?"
            confirmLabel="Yes, delete"
            disabled={busy}
            onConfirm={() => void remove()}
          />
        </span>
      )}
    </DrawerFooter>
  );

  if (record === null) {
    return (
      <Drawer open title={title} onClose={onClose} wide>
        <DrawerBody>{form}</DrawerBody>
        {footer}
      </Drawer>
    );
  }

  const saved = (updated: RecordItem) => onSaved(updated, false);
  const nameField = titleField(fields) ?? fields[0];
  const taskName = displayValue(nameField, record.data[nameField.id], names);

  return (
    <Drawer open title={taskName || "(untitled)"} onClose={onClose} wide>
      <TaskSummary
        fields={fields}
        record={record}
        names={names}
        currentUserId={currentUserId}
        reviewer={reviewer}
        admin={admin}
        onChanged={saved}
        onReload={onReload}
      />
      <div className="px-4 pt-2">
        <Tabs label="Task sections" idPrefix={TABS_ID} tabs={RECORD_TABS} value={tab} onChange={setTab} />
      </div>
      <DrawerBody role="tabpanel" id={`${TABS_ID}-panel-${tab}`} aria-labelledby={`${TABS_ID}-tab-${tab}`}>
        {tab === "details" && (
          <>
            {form}
            <div className="grid gap-5 border-t border-line pt-4">
              {timers.map((timer) => (
                <section
                  key={timer.id}
                  aria-label={timers.length > 1 ? timer.name : "Time"}
                  className="grid gap-2"
                >
                  <h3 className="m-0 flex items-center gap-1.5 text-sm">
                    <Timer className="size-4 text-muted" aria-hidden />
                    {timers.length > 1 ? timer.name : "Time spent"}
                  </h3>
                  <TimerCell
                    fields={fields}
                    field={timer}
                    record={record}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    onChanged={saved}
                  />
                </section>
              ))}
              <SubtaskForm
                tableId={tableId}
                fields={fields}
                parent={record}
                currentUserId={currentUserId}
                canCreate={canCreate}
                onCreated={(subtask) => onSubtaskCreated?.(subtask)}
              />
              {canHandOver && <HandoverForm record={record} onChanged={saved} />}
            </div>
          </>
        )}
        {tab === "comments" && (
          <CommentsPanel recordId={record.id} currentUserId={currentUserId} admin={admin} />
        )}
        {tab === "history" && (
          <ActivityPanel recordId={record.id} version={record.version} fields={fields} />
        )}
        {tab === "access" && <RecordViewersPanel fields={fields} record={record} onChanged={saved} />}
      </DrawerBody>
      {tab === "details" && footer}
    </Drawer>
  );
}
