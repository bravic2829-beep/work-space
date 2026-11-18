"use client";

import { Download, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Button, DataTable, EmptyState, InlineConfirm, LoadingState, useToast } from "@/components/ui";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

import { deleteFileForever, listFileTrash, restoreFile, trashedFileDownloadUrl } from "./api";
import type { FileTrashItem, FileTrashPage } from "./schema";

export function FileTrashPanel() {
  const [page, setPage] = useState<FileTrashPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const nextCursor = page?.next_cursor;

  useEffect(() => {
    const controller = new AbortController();
    listFileTrash(null, controller.signal)
      .then(setPage)
      .catch((error) => {
        if (!controller.signal.aborted) setProblem(errorMessage(error, "Could not load files."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function change(item: FileTrashItem, restore: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      await (restore ? restoreFile(item.id) : deleteFileForever(item.id));
      setPage((current) =>
        current && { ...current, items: current.items.filter((file) => file.id !== item.id) },
      );
      toast(restore ? `Restored “${item.name}”.` : `Deleted “${item.name}” for good.`);
    } catch (error) {
      setProblem(errorMessage(error, restore ? "Could not restore the file." : "Could not delete the file."));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore(cursor: string) {
    setBusy(true);
    setProblem(null);
    try {
      const next = await listFileTrash(cursor);
      setPage((current) => ({
        items: [...(current?.items ?? []), ...next.items],
        next_cursor: next.next_cursor,
      }));
    } catch (error) {
      setProblem(errorMessage(error, "Could not load more files."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-muted">Deleted attachments can be restored for 7 days.</p>
      {loading && <LoadingState />}
      {problem && <Alert>{problem}</Alert>}
      {page?.items.length === 0 && page.next_cursor === null && (
        <EmptyState icon={Trash2} title="No deleted files." />
      )}
      {page && page.items.length > 0 && (
        <DataTable dense aria-label="Deleted files">
          <thead>
            <tr>
              <th>File</th>
              <th>Original location</th>
              <th>Deleted by</th>
              <th>Deleted</th>
              <th>Expires</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((file) => (
              <tr key={file.id}>
                <td className="font-medium">{file.name}</td>
                <td>
                  {file.original ? (
                    <>
                      <Link href={`/tables/${file.original.table_id}`}>{file.original.table_name}</Link>
                      <div className="text-xs text-muted">
                        {[file.original.record_name, file.original.field_name].filter(Boolean).join(" / ")}
                      </div>
                    </>
                  ) : "Original location unavailable"}
                </td>
                <td>{file.deleted_by}</td>
                <td>{formatDateTime(file.deleted_at)}</td>
                <td>{formatDateTime(file.purge_at)}</td>
                <td className="text-right whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    {file.can_restore && (
                      <Button size="sm" icon={RotateCcw} disabled={busy}
                        aria-label={`Restore ${file.name}`} onClick={() => void change(file, true)}>
                        Restore
                      </Button>
                    )}
                    {file.can_delete_forever && (
                      <>
                        <a href={trashedFileDownloadUrl(file.id)} download={file.name}
                          aria-label={`Download ${file.name}`} title="Download" className="p-1.5">
                          <Download className="size-4" aria-hidden />
                        </a>
                        <InlineConfirm label={`Delete ${file.name} forever`}
                          prompt="Delete this file for good? This cannot be undone."
                          confirmLabel="Yes, delete" icon={Trash2} disabled={busy}
                          onConfirm={() => void change(file, false)} />
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {nextCursor && (
        <div>
          <Button disabled={busy} onClick={() => void loadMore(nextCursor)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
