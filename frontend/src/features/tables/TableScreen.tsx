"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";

import { AddFieldForm } from "./AddFieldForm";
import { createView, deleteView, getTable, listRecords, listViews } from "./api";
import { FilterBar } from "./FilterBar";
import { RecordGrid } from "./RecordGrid";
import { RecordSidebar } from "./RecordSidebar";
import type {
  Condition,
  FieldItem,
  RecordItem,
  SortColumn,
  TableDetail,
  ViewItem,
} from "./schema";
import { useUserNames } from "./useUserNames";
import { userIdsIn } from "./values";

type TableState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; table: TableDetail };

type RecordsState =
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "ready"; items: RecordItem[]; nextCursor: string | null };

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You do not have access to this table.";
    if (error.status === 404) return "This table does not exist.";
    return error.message;
  }
  return "Something went wrong.";
}

/** The table view: columns, rows, filter, sort, saved views, and the record panel. */
export function TableScreen({ tableId }: { tableId: string }) {
  const { state: auth } = useAuth();
  const me = auth.status === "authenticated" ? auth.user.id : "";

  const [tableState, setTableState] = useState<TableState>({ kind: "loading" });
  const [tableKey, setTableKey] = useState(0);
  const [views, setViews] = useState<ViewItem[]>([]);
  const [activeView, setActiveView] = useState("");
  const [filter, setFilter] = useState<Condition[]>([]);
  const [sort, setSort] = useState<SortColumn[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [records, setRecords] = useState<RecordsState>({ kind: "loading" });
  const [recordsKey, setRecordsKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [showAddField, setShowAddField] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const table = await getTable(tableId, controller.signal);
        setTableState({ kind: "ready", table });
      } catch (error) {
        if (!controller.signal.aborted) setTableState({ kind: "error", error });
        return;
      }
      try {
        setViews(await listViews(tableId, controller.signal));
      } catch {
        // Views are a convenience: the table still works without them.
      }
    }
    void load();
    return () => controller.abort();
  }, [tableId, tableKey]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const page = await listRecords(tableId, { filter, sort }, controller.signal);
        setRecords({ kind: "ready", items: page.items, nextCursor: page.next_cursor });
      } catch (error) {
        if (!controller.signal.aborted) setRecords({ kind: "error", error });
      }
    }
    void load();
    return () => controller.abort();
  }, [tableId, filter, sort, recordsKey]);

  const table = tableState.kind === "ready" ? tableState.table : null;
  const items = records.kind === "ready" ? records.items : [];
  const shownFields = useMemo<FieldItem[]>(() => {
    if (!table) return [];
    const kept = table.fields.filter((field) => !hidden.includes(field.id));
    return kept.length > 0 ? kept : table.fields.slice(0, 1);
  }, [table, hidden]);
  const names = useUserNames(userIdsIn(shownFields, items));

  if (tableState.kind === "loading") return <p role="status">Loading…</p>;
  if (tableState.kind === "error" || !table) {
    return (
      <p role="alert">
        {describe(tableState.kind === "error" ? tableState.error : null)}{" "}
        <button type="button" onClick={() => setTableKey((n) => n + 1)}>
          Try again
        </button>
      </p>
    );
  }

  const canEdit = table.my_role === "editor" || table.my_role === "admin";
  const selectedRecord = selected && selected !== "new" ? items.find((r) => r.id === selected) : null;

  function reloadRecords() {
    setRecords({ kind: "loading" });
    setRecordsKey((n) => n + 1);
  }

  function toggleSort(field: FieldItem) {
    const current = sort.find((column) => column.field === field.id);
    if (!current) setSort([{ field: field.id, direction: "asc" }]);
    else if (current.direction === "asc") setSort([{ field: field.id, direction: "desc" }]);
    else setSort([]);
    setActiveView("");
  }

  async function loadMore() {
    if (records.kind !== "ready" || !records.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listRecords(tableId, { filter, sort, cursor: records.nextCursor });
      setRecords({
        kind: "ready",
        items: [...records.items, ...page.items],
        nextCursor: page.next_cursor,
      });
    } catch (error) {
      setNotice(describe(error));
    } finally {
      setLoadingMore(false);
    }
  }

  function applyView(id: string) {
    setActiveView(id);
    const view = views.find((v) => v.id === id);
    const known = new Set(table?.fields.map((f) => f.id));
    // Columns that were deleted or hidden from this person since the view was saved are dropped.
    setFilter(view ? view.config.filter.filter((c) => known.has(c.field)) : []);
    setSort(view ? view.config.sort.filter((c) => known.has(c.field)) : []);
    setHidden(view ? view.config.hidden_fields.filter((f) => known.has(f)) : []);
  }

  async function saveView(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    try {
      const view = await createView(tableId, viewName.trim(), {
        filter,
        sort,
        hidden_fields: hidden,
      });
      setViews((current) => [...current, view]);
      setActiveView(view.id);
      setSavingView(false);
      setViewName("");
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not save the view.");
    }
  }

  async function removeView() {
    if (!activeView) return;
    try {
      await deleteView(activeView);
      setViews((current) => current.filter((v) => v.id !== activeView));
      setActiveView("");
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not delete the view.");
    }
  }

  return (
    <div className="table-screen">
      <p>
        <Link href={`/workspaces`}>Workspaces</Link>
      </p>
      <h1>{table.name}</h1>

      <section aria-label="View" className="toolbar">
        <label>
          View{" "}
          <select value={activeView} onChange={(event) => applyView(event.target.value)}>
            <option value="">All records</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
        {activeView && (
          <button type="button" onClick={() => void removeView()}>
            Delete this view
          </button>
        )}
        {!savingView ? (
          <button type="button" onClick={() => setSavingView(true)}>
            Save as a view
          </button>
        ) : (
          <form onSubmit={(event) => void saveView(event)} className="inline-form">
            <input
              aria-label="View name"
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
              maxLength={100}
              required
            />
            <button type="submit" disabled={viewName.trim() === ""}>
              Save view
            </button>
            <button type="button" onClick={() => setSavingView(false)}>
              Cancel
            </button>
          </form>
        )}
        <details>
          <summary>Columns</summary>
          <ul className="plain">
            {table.fields.map((field) => (
              <li key={field.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(field.id)}
                    onChange={(event) => {
                      setActiveView("");
                      setHidden((current) =>
                        event.target.checked
                          ? current.filter((id) => id !== field.id)
                          : [...current, field.id],
                      );
                    }}
                  />{" "}
                  {field.name}
                </label>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <FilterBar
        fields={table.fields}
        filter={filter}
        onChange={(next) => {
          setActiveView("");
          setFilter(next);
        }}
      />

      <div className="toolbar">
        {canEdit && (
          <>
            <button type="button" onClick={() => setSelected("new")}>
              New record
            </button>
            <button type="button" onClick={() => setShowAddField((value) => !value)}>
              {showAddField ? "Hide column form" : "Add a column"}
            </button>
          </>
        )}
      </div>

      {showAddField && canEdit && (
        <AddFieldForm
          tableId={table.id}
          baseId={table.base_id}
          onCreated={() => {
            setShowAddField(false);
            setTableKey((n) => n + 1);
            reloadRecords();
          }}
        />
      )}

      {notice && <p role="alert">{notice}</p>}

      <div className={selected ? "with-sidebar" : undefined}>
        <div>
          {records.kind === "loading" && <p role="status">Loading records…</p>}
          {records.kind === "error" && (
            <p role="alert">
              {describe(records.error)}{" "}
              {filter.length + sort.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter([]);
                    setSort([]);
                    setActiveView("");
                  }}
                >
                  Clear filter and sort
                </button>
              )}
              <button type="button" onClick={reloadRecords}>
                Try again
              </button>
            </p>
          )}
          {records.kind === "ready" && (
            <RecordGrid
              fields={shownFields}
              records={items}
              names={names}
              sort={sort}
              selectedId={selectedRecord?.id ?? null}
              hasMore={records.nextCursor !== null}
              loadingMore={loadingMore}
              onSort={toggleSort}
              onSelect={(record) => setSelected(record.id)}
              onLoadMore={() => void loadMore()}
            />
          )}
        </div>
        {selected === "new" && (
          <RecordSidebar
            key="new"
            tableId={table.id}
            fields={table.fields}
            record={null}
            currentUserId={me}
            canCreate={canEdit}
            onSaved={(record) => {
              setSelected(record.id);
              reloadRecords();
            }}
            onDeleted={() => undefined}
            onReload={reloadRecords}
            onClose={() => setSelected(null)}
          />
        )}
        {selectedRecord && (
          <RecordSidebar
            key={`${selectedRecord.id}-${selectedRecord.version}`}
            tableId={table.id}
            fields={table.fields}
            record={selectedRecord}
            currentUserId={me}
            canCreate={canEdit}
            onSaved={(saved) =>
              setRecords((current) =>
                current.kind === "ready"
                  ? {
                      ...current,
                      items: current.items.map((item) => (item.id === saved.id ? saved : item)),
                    }
                  : current,
              )
            }
            onDeleted={(id) => {
              setSelected(null);
              setRecords((current) =>
                current.kind === "ready"
                  ? { ...current, items: current.items.filter((item) => item.id !== id) }
                  : current,
              );
            }}
            onReload={reloadRecords}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
