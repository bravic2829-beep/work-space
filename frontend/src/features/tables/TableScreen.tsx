"use client";

import { ChevronLeft, Columns3, Plus, Save, Settings2, Table2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Alert, Button, Drawer, DrawerBody, Input, LoadingState, Select } from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { ApiError } from "@/lib/api/client";

import { AddFieldForm } from "./AddFieldForm";
import { createView, deleteRecord, deleteView, getTable, listRecords, listViews } from "./api";
import { FilterBar } from "./FilterBar";
import { ManageFieldsPanel } from "./ManageFieldsPanel";
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

function keepKnown<T>(items: T[], known: Set<string> | null, idOf: (item: T) => string): T[] {
  if (!known || items.every((item) => known.has(idOf(item)))) return items;
  return items.filter((item) => known.has(idOf(item)));
}

/** The table view: columns, rows, filter, sort, saved views, and the record panel. */
export function TableScreen({ tableId }: { tableId: string }) {
  const { state: auth } = useAuth();
  const me = auth.status === "authenticated" ? auth.user.id : "";

  const [tableState, setTableState] = useState<TableState>({ kind: "loading" });
  const [tableKey, setTableKey] = useState(0);
  const [views, setViews] = useState<ViewItem[]>([]);
  const [activeView, setActiveView] = useState("");
  const [rawFilter, setFilter] = useState<Condition[]>([]);
  const [rawSort, setSort] = useState<SortColumn[]>([]);
  const [rawHidden, setHidden] = useState<string[]>([]);
  const [records, setRecords] = useState<RecordsState>({ kind: "loading" });
  const [recordsKey, setRecordsKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [showAddField, setShowAddField] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // A column deleted (here or by someone else) must not stay in the filter, sort or hidden list:
  // the server would answer 422 for a column it no longer knows. So these are derived, not stored.
  const knownIds = useMemo(
    () => (tableState.kind === "ready" ? new Set(tableState.table.fields.map((f) => f.id)) : null),
    [tableState],
  );
  // Same array back when nothing was dropped: a new one would make the records load again.
  const filter = useMemo(
    () => keepKnown(rawFilter, knownIds, (c) => c.field),
    [rawFilter, knownIds],
  );
  const sort = useMemo(() => keepKnown(rawSort, knownIds, (c) => c.field), [rawSort, knownIds]);
  const hidden = useMemo(() => keepKnown(rawHidden, knownIds, (id) => id), [rawHidden, knownIds]);

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

  if (tableState.kind === "loading") return <LoadingState>Loading…</LoadingState>;
  if (tableState.kind === "error" || !table) {
    return (
      <Alert>
        <span className="mr-2">
          {describe(tableState.kind === "error" ? tableState.error : null)}
        </span>
        <Button size="sm" onClick={() => setTableKey((n) => n + 1)}>
          Try again
        </Button>
      </Alert>
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

  /** Deleting is for good: there is no trash step. The row leaves the list at once. */
  async function removeRecord(record: RecordItem) {
    setNotice(null);
    try {
      await deleteRecord(record.id);
      if (selected === record.id) setSelected(null);
      setRecords((current) =>
        current.kind === "ready"
          ? { ...current, items: current.items.filter((item) => item.id !== record.id) }
          : current,
      );
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not delete the record.");
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
    <div className="flex flex-col gap-3">
      <div>
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-0.5 text-xs text-muted no-underline hover:text-primary"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Workspaces
        </Link>
        <h1 className="m-0 flex items-center gap-2">
          <Table2 className="size-5 text-primary" aria-hidden />
          {table.name}
        </h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <section aria-label="View" className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] font-medium">
            View
            <Select
              className="h-7 w-auto py-0 text-[13px]"
              value={activeView}
              onChange={(event) => applyView(event.target.value)}
            >
              <option value="">All records</option>
              {views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </Select>
          </label>
          {activeView && (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void removeView()}>
              Delete this view
            </Button>
          )}
          {!savingView ? (
            <Button size="sm" icon={Save} onClick={() => setSavingView(true)}>
              Save as a view
            </Button>
          ) : (
            <form onSubmit={(event) => void saveView(event)} className="flex items-center gap-1.5">
              <Input
                aria-label="View name"
                className="h-7 w-40 py-0 text-[13px]"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
                maxLength={100}
                required
              />
              <Button type="submit" size="sm" variant="primary" disabled={viewName.trim() === ""}>
                Save view
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSavingView(false)}>
                Cancel
              </Button>
            </form>
          )}
          <details className="relative">
            <summary className="inline-flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-xs font-medium hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
              <Columns3 className="size-4" aria-hidden />
              Columns
              {hidden.length > 0 && (
                <span className="rounded bg-primary-soft px-1 font-mono text-[10px] text-primary">
                  {table.fields.length - hidden.length}/{table.fields.length}
                </span>
              )}
            </summary>
            <ul className="absolute z-20 m-0 mt-1 max-h-72 w-56 list-none overflow-y-auto rounded-lg border border-line-strong bg-surface p-1.5 shadow-lg">
              {table.fields.map((field) => (
                <li key={field.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[13px] hover:bg-surface-muted">
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
                    />
                    {field.name}
                  </label>
                </li>
              ))}
            </ul>
          </details>
        </section>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Plus} onClick={() => { setShowManage(false); setShowAddField(true); }}>
              Add a column
            </Button>
            <Button size="sm" icon={Settings2} onClick={() => { setShowAddField(false); setShowManage(true); }}>
              Manage columns
            </Button>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setSelected("new")}>
              New record
            </Button>
          </div>
        )}
      </div>

      <FilterBar
        fields={table.fields}
        filter={filter}
        onChange={(next) => {
          setActiveView("");
          setFilter(next);
        }}
      />

      <Drawer open={showManage && canEdit} title="Manage columns" onClose={() => setShowManage(false)}>
        <DrawerBody>
          <ManageFieldsPanel
            fields={table.fields}
            onChanged={() => {
              setTableKey((n) => n + 1);
              reloadRecords();
            }}
          />
        </DrawerBody>
      </Drawer>

      <Drawer open={showAddField && canEdit} title="Add a column" onClose={() => setShowAddField(false)}>
        <DrawerBody>
          <AddFieldForm
            tableId={table.id}
            baseId={table.base_id}
            existing={table.fields}
            onCreated={() => {
              setShowAddField(false);
              setTableKey((n) => n + 1);
              reloadRecords();
            }}
          />
        </DrawerBody>
      </Drawer>

      {notice && <Alert>{notice}</Alert>}

      <div>
        <div className="min-w-0">
          {records.kind === "loading" && <LoadingState>Loading records…</LoadingState>}
          {records.kind === "error" && (
            <Alert>
              <span className="mr-2">{describe(records.error)}</span>
              {filter.length + sort.length > 0 && (
                <Button
                  size="sm"
                  className="mr-1.5"
                  onClick={() => {
                    setFilter([]);
                    setSort([]);
                    setActiveView("");
                  }}
                >
                  Clear filter and sort
                </Button>
              )}
              <Button size="sm" onClick={reloadRecords}>
                Try again
              </Button>
            </Alert>
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
              canEdit={canEdit}
              currentUserId={me}
              onDelete={(record) => void removeRecord(record)}
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
            onSubtaskCreated={reloadRecords}
          />
        )}
      </div>
    </div>
  );
}
