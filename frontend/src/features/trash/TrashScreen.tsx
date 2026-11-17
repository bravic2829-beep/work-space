"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  InlineConfirm,
  LoadingState,
  PageHeader,
} from "@/components/ui";
import { ApiError } from "@/lib/api/client";

import { deleteForever, listTrash, restoreRecord } from "./api";
import type { TrashItem } from "./schema";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; items: TrashItem[]; nextCursor: string | null };

/** The records I deleted. They can be restored for 30 days, then they are removed for good. */
export function TrashScreen() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const page = await listTrash(null, controller.signal);
        setState({ kind: "ready", items: page.items, nextCursor: page.next_cursor });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Could not load the trash.",
        });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  async function restore(item: TrashItem) {
    if (state.kind !== "ready") return;
    setBusyId(item.id);
    setProblem(null);
    setNotice(null);
    try {
      await restoreRecord(item.id);
      setState({ ...state, items: state.items.filter((other) => other.id !== item.id) });
      setNotice(`Restored "${item.name ?? "a record"}" to ${item.table_name}.`);
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "Could not restore the record.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeForGood(item: TrashItem) {
    if (state.kind !== "ready") return;
    setBusyId(item.id);
    setProblem(null);
    setNotice(null);
    try {
      await deleteForever(item.id);
      setState({
        ...state,
        items: state.items.filter((other) => other.id !== item.id),
      });
      setNotice(`Removed "${item.name ?? "a record"}" for good.`);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? error.message
          : "Could not remove the record.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function loadMore() {
    if (state.kind !== "ready" || state.nextCursor === null) return;
    try {
      const page = await listTrash(state.nextCursor);
      setState({
        kind: "ready",
        items: [...state.items, ...page.items],
        nextCursor: page.next_cursor,
      });
    } catch {
      setProblem("Could not load more.");
    }
  }

  return (
    <>
      <PageHeader
        title="Trash"
        description="Records you deleted. Restore them within 30 days, delete them for good now, or they are removed automatically after 30 days."
      />
      <div className="grid gap-3">
        {state.kind === "loading" && <LoadingState />}
        {state.kind === "error" && <Alert>{state.message}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        {problem && <Alert>{problem}</Alert>}
        {state.kind === "ready" && state.items.length === 0 && (
          <EmptyState icon={Trash2} title="The trash is empty.">
            Records you delete will wait here for 30 days.
          </EmptyState>
        )}
        {state.kind === "ready" && state.items.length > 0 && (
          <DataTable dense>
            <thead>
              <tr>
                <th>Record</th>
                <th>Table</th>
                <th>Deleted</th>
                <th>Removed for good</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium">{item.name ?? "(name hidden)"}</td>
                  <td>
                    <Link href={`/tables/${item.table_id}`}>{item.table_name}</Link>
                  </td>
                  <td>{new Date(item.deleted_at).toLocaleDateString()}</td>
                  <td>{new Date(item.purge_at).toLocaleDateString()}</td>
                  <td className="text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        icon={RotateCcw}
                        disabled={busyId !== null}
                        aria-label={`Restore ${item.name ?? "record"}`}
                        onClick={() => void restore(item)}
                      >
                        Restore
                      </Button>
                      <InlineConfirm
                        label={`Delete ${item.name ?? "record"} forever`}
                        prompt="Delete for good? This cannot be undone."
                        confirmLabel="Yes, delete"
                        icon={Trash2}
                        disabled={busyId !== null}
                        onConfirm={() => void removeForGood(item)}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        {state.kind === "ready" && state.nextCursor !== null && (
          <div>
            <Button onClick={() => void loadMore()}>Load more</Button>
          </div>
        )}
      </div>
    </>
  );
}
