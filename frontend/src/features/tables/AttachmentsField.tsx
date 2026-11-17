"use client";

import { Download, FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

import { Alert, Button, InlineConfirm } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";

import {
  attachmentUrl,
  checkFile,
  deleteAttachment,
  FILE_ACCEPT,
  formatSize,
  MAX_FILE_BYTES,
  uploadAttachment,
} from "./attachments";
import { filesOf, type FieldItem, type RecordItem } from "./schema";

type Props = {
  field: FieldItem;
  /** The task, or null while a new one is being written (files need a saved task). */
  record: RecordItem | null;
  /** The person may add and remove files in this column. */
  canEdit: boolean;
  /** The task came back from the server with its new list of files. */
  onChanged: (record: RecordItem) => void;
};

/**
 * The files of one column in the task panel: the list (each name downloads the file), and, for
 * somebody who may edit the column, a way to add files (the button, or drop them here) and to
 * remove them. Adding and removing happen at once; they are not part of "Save changes".
 */
export function AttachmentsField({ field, record, canEdit, onChanged }: Props) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const files = record ? filesOf(record.data[field.id]) : [];

  async function add(chosen: File[]) {
    if (!record || chosen.length === 0) return;
    const found: string[] = [];
    let current = record;
    for (const file of chosen) {
      const refused = checkFile(file);
      if (refused) {
        found.push(refused);
        continue;
      }
      setBusy(file.name);
      try {
        current = await uploadAttachment(current.id, field.id, file);
        onChanged(current);
      } catch (error) {
        found.push(
          error instanceof ApiError
            ? `“${file.name}”: ${error.message}`
            : `“${file.name}” could not be added.`,
        );
      }
    }
    setBusy(null);
    setProblems(found);
  }

  async function remove(id: string) {
    setProblems([]);
    try {
      onChanged(await deleteAttachment(id));
    } catch (error) {
      setProblems([error instanceof ApiError ? error.message : "Could not remove the file."]);
    }
  }

  return (
    <div className="cell-editor">
      <div className="label">{field.name}</div>
      {record === null ? (
        <p className="m-0 text-sm text-muted">Save the task first, then you can add files.</p>
      ) : (
        <>
          {files.length > 0 && (
            <ul aria-label={`Files of ${field.name}`} className="m-0 grid list-none gap-1 p-0">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5"
                >
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                  <a
                    href={attachmentUrl(file.id)}
                    download={file.name}
                    className="min-w-0 flex-1 truncate font-medium"
                    title={`Download ${file.name}`}
                  >
                    {file.name}
                  </a>
                  <span className="shrink-0 text-xs text-muted">{formatSize(file.size)}</span>
                  <a
                    href={attachmentUrl(file.id)}
                    download={file.name}
                    aria-label={`Download ${file.name}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-muted"
                  >
                    <Download className="size-4" aria-hidden />
                  </a>
                  {canEdit && (
                    <InlineConfirm
                      label={`Remove ${file.name}`}
                      icon={X}
                      prompt="Remove this file?"
                      confirmLabel="Yes, remove"
                      onConfirm={() => void remove(file.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {files.length === 0 && !canEdit && <p className="m-0 text-sm text-muted">No files.</p>}
          {canEdit && (
            <div
              className={cn(
                "grid justify-items-start gap-1.5 rounded-md border border-dashed border-line-strong p-3",
                dragging && "border-primary bg-primary-soft",
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void add([...event.dataTransfer.files]);
              }}
            >
              <input
                ref={input}
                type="file"
                multiple
                hidden
                accept={FILE_ACCEPT}
                aria-label={`Choose files for ${field.name}`}
                onChange={(event) => {
                  void add([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              <Button
                size="sm"
                icon={Upload}
                disabled={busy !== null}
                onClick={() => input.current?.click()}
              >
                {busy ? `Adding ${busy}…` : "Add files"}
              </Button>
              <span className="text-xs text-muted">
                Or drop them here. Up to {MAX_FILE_BYTES / 1_000_000} MB each: documents, sheets,
                slides, pictures and archives.
              </span>
            </div>
          )}
          {problems.length > 0 && (
            <Alert>
              <ul className="m-0 list-none p-0">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
