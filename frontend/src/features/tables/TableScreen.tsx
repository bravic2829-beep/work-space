"use client";

import { useEffect, useMemo, useState } from "react";

import { usePageCrumb } from "@/components/Breadcrumb";
import {
  Alert,
  Button,
  Drawer,
  DrawerBody,
  LoadingState,
  SkeletonTable,
  useToast,
} from "@/components/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { isOrgAdmin } from "@/features/auth/schema";
import { useLiveRefresh } from "@/features/notifications/liveRefresh";
import { createSheetRecord, listSheetRecords } from "@/features/sheets/api";
import { CreateSheetDrawer } from "@/features/sheets/CreateSheetDrawer";
import { sheetAccess, type SheetItem } from "@/features/sheets/schema";
import { ApiError } from "@/lib/api/client";

import { AddFieldForm } from "./AddFieldForm";
import { AssignTaskDrawer, assignTargets } from "./AssignTaskDrawer";
import {
  createField,
  createView,
  deleteRecord,
  deleteView,
  getTable,
  listRecords,
  listViews,
} from "./api";
import { ColumnsMenu } from "./ColumnsMenu";
import { FilterBar } from "./FilterBar";
import { ManageFieldsPanel } from "./ManageFieldsPanel";
import { RecordGrid } from "./RecordGrid";
import { RecordSidebar } from "./RecordSidebar";
import { SortMenu } from "./SortMenu";
import { TableToolbar } from "./TableToolbar";
import type {
  Condition,
  FieldItem,
  RecordItem,
  SortColumn,
  TableDetail,
  ViewItem,
} from "./schema";
import { fieldBySemantic } from "./taskWorkflow";
import { timerColumns } from "./timer";
import { useHiddenColumns } from "./useHiddenColumns";
import { useUserNames } from "./useUserNames";
import { userIdsIn } from "./values";
import { errorMessage } from "@/lib/api/errors";

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

type Props = {
  tableId: string;
  /**
   * Show one sheet of the table instead of the whole table: only the sheet's tasks, with the
   * controls its role allows. A person who is not a member of the workspace uses a table this way.
   */
  sheet?: SheetItem;
  /**
   * A number that goes up each time somebody presses "Add task" outside this screen (the sheet
   * tab strip keeps that button next to Share); the new-task form opens on every change.
   */
  addTaskSignal?: number;
};

/** The table view: columns, rows, filter, sort, saved views, and the record panel. */
export function TableScreen({ tableId, sheet, addTaskSignal = 0 }: Props) {
  const { state: auth } = useAuth();
  const sheetId = sheet?.id;
  const sheetRole = sheet?.my_role;
  const me = auth.status === "authenticated" ? auth.user.id : "";

  const [tableState, setTableState] = useState<TableState>({ kind: "loading" });
  const [tableKey, setTableKey] = useState(0);
  const [views, setViews] = useState<ViewItem[]>([]);
  const [activeView, setActiveView] = useState("");
  const [rawFilter, setFilter] = useState<Condition[]>([]);
  const [rawSort, setSort] = useState<SortColumn[]>([]);
  const [rawHidden, setHidden] = useHiddenColumns(tableId);
  const [records, setRecords] = useState<RecordsState>({ kind: "loading" });
  const [recordsKey, setRecordsKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [showAddField, setShowAddField] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const toast = useToast();
  const [addingTimer, setAddingTimer] = useState(false);
  const [showCreateSheet, setShowCreateSheet] = useState(false);

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
      if (sheetId) return; // saved views belong to the workspace, not to a sheet
      try {
        setViews(await listViews(tableId, controller.signal));
      } catch {
        // Views are a convenience: the table still works without them.
      }
    }
    void load();
    return () => controller.abort();
  }, [tableId, tableKey, sheetId]);

  // "Add task" pressed outside this screen: open the new-task form once per press. The signal the
  // screen starts with is already handled, so a sheet opened later does not open the form.
  const [seenSignal, setSeenSignal] = useState(addTaskSignal);
  if (addTaskSignal !== seenSignal) {
    setSeenSignal(addTaskSignal);
    setSelected("new");
  }

  // A task given to me appears at once. Reads again without the loading flash or closing the panel.
  useLiveRefresh(() => setRecordsKey((n) => n + 1));

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = { filter, sort };
        const page = sheetId
          ? await listSheetRecords(sheetId, query, controller.signal)
          : await listRecords(tableId, query, controller.signal);
        setRecords({ kind: "ready", items: page.items, nextCursor: page.next_cursor });
      } catch (error) {
        if (!controller.signal.aborted) setRecords({ kind: "error", error });
      }
    }
    void load();
    return () => controller.abort();
  }, [tableId, sheetId, filter, sort, recordsKey]);

  const table = tableState.kind === "ready" ? tableState.table : null;
  usePageCrumb(table?.name ?? null);

  // On a sheet the columns show what the person's role on the sheet allows.
  const fields = useMemo<FieldItem[]>(() => {
    if (!table) return [];
    if (!sheetRole) return table.fields;
    return table.fields.map((field) => ({ ...field, access: sheetAccess(sheetRole, field) }));
  }, [table, sheetRole]);

  const items = records.kind === "ready" ? records.items : [];
  const shownFields = useMemo<FieldItem[]>(() => {
    const kept = fields.filter((field) => !hidden.includes(field.id));
    return kept.length > 0 ? kept : fields.slice(0, 1);
  }, [fields, hidden]);
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

  const canEdit = sheetRole
    ? sheetRole === "editor" || sheetRole === "manager"
    : table.my_role === "editor" || table.my_role === "admin";
  const canAssign = !sheet && canEdit && assignTargets(table.fields) !== null;
  const isAdmin = auth.status === "authenticated" && isOrgAdmin(auth.user);
  // On a sheet, a manager of the sheet may start and stop the timer and review, like an admin.
  const sheetManager = sheetRole === "manager";
  const isTaskTable =
    fieldBySemantic(table.fields, "assignee") !== undefined &&
    fieldBySemantic(table.fields, "status") !== undefined;
  // A task table that has no timer yet can get one.
  const canAddTimer = !sheet && canEdit && isTaskTable && timerColumns(table.fields).length === 0;
  // The admin of the table's workspace may give a person a sheet of it.
  const canMakeSheet = !sheet && (isAdmin || table.my_role === "admin") && isTaskTable;
  const selectedRecord = selected && selected !== "new" ? items.find((r) => r.id === selected) : null;

  function reloadRecords() {
    setRecords({ kind: "loading" });
    setRecordsKey((n) => n + 1);
  }

  /** A row came back from the server changed: show it in place, without a reload. */
  function replaceRecord(saved: RecordItem) {
    setRecords((current) =>
      current.kind === "ready"
        ? { ...current, items: current.items.map((item) => (item.id === saved.id ? saved : item)) }
        : current,
    );
  }

  /** Gives an older task table a timer column (new task tables already have one). */
  async function addTimer() {
    setNotice(null);
    setAddingTimer(true);
    try {
      await createField(tableId, { name: "Timer", type: "timer" });
      setTableKey((n) => n + 1);
      reloadRecords();
    } catch (error) {
      setNotice(errorMessage(error, "Could not add the timer."));
    } finally {
      setAddingTimer(false);
    }
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
      const query = { filter, sort, cursor: records.nextCursor };
      const page = sheetId ? await listSheetRecords(sheetId, query) : await listRecords(tableId, query);
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
      setNotice(errorMessage(error, "Could not delete the record."));
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

  /** Saves the current filter, sort and columns as a view. True when it was saved. */
  async function saveView(name: string): Promise<boolean> {
    setNotice(null);
    try {
      const view = await createView(tableId, name, {
        filter,
        sort,
        hidden_fields: hidden,
      });
      setViews((current) => [...current, view]);
      setActiveView(view.id);
      return true;
    } catch (error) {
      setNotice(errorMessage(error, "Could not save the view."));
      return false;
    }
  }

  async function removeView() {
    if (!activeView) return;
    try {
      await deleteView(activeView);
      setViews((current) => current.filter((v) => v.id !== activeView));
      setActiveView("");
    } catch (error) {
      setNotice(errorMessage(error, "Could not delete the view."));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The name and the way back are in the top bar; the heading stays for screen readers. */}
      <h1 className="sr-only">{table.name}</h1>

      {/* On a sheet the buttons live in the sheet tab strip. */}
      {!sheet && (
        <TableToolbar
          views={views}
          activeView={activeView}
          onApplyView={applyView}
          onSaveView={saveView}
          onRemoveView={() => void removeView()}
          canEdit={canEdit}
          canAssign={canAssign}
          canMakeSheet={canMakeSheet}
          canAddTimer={canAddTimer}
          addingTimer={addingTimer}
          onNewRecord={() => setSelected("new")}
          onAssign={() => {
            setSelected(null);
            setShowAssign(true);
          }}
          onAddField={() => {
            setShowManage(false);
            setShowAddField(true);
          }}
          onManageFields={() => {
            setShowAddField(false);
            setShowManage(true);
          }}
          onAddTimer={() => void addTimer()}
          onCreateSheet={() => setShowCreateSheet(true)}
        />
      )}

      <FilterBar
        fields={fields}
        filter={filter}
        onChange={(next) => {
          setActiveView("");
          setFilter(next);
        }}
        trailing={
          <ColumnsMenu
            fields={fields}
            hidden={hidden}
            onChange={(next) => {
              setActiveView("");
              setHidden(next);
            }}
          />
        }
      >
        <SortMenu fields={shownFields} sort={sort} onToggle={toggleSort} />
      </FilterBar>

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

      {showAssign && canAssign && (
        <AssignTaskDrawer
          tableId={table.id}
          fields={table.fields}
          onClose={() => setShowAssign(false)}
          onAssigned={(record, taskName, assignee) => {
            toast(`Assigned “${taskName}” to ${assignee}.`, {
              action: { label: "View", onClick: () => setSelected(record.id) },
            });
            reloadRecords();
          }}
        />
      )}

      {showCreateSheet && canMakeSheet && (
        <CreateSheetDrawer
          tableId={table.id}
          onClose={() => setShowCreateSheet(false)}
          onCreated={(created) => {
            toast(`Sheet “${created.name}” created. Open Work summary in the sidebar to see it.`);
          }}
        />
      )}

      {notice && <Alert>{notice}</Alert>}

      <div>
        <div className="min-w-0">
          {records.kind === "loading" && (
            <SkeletonTable headings={shownFields.map((field) => field.name)} label="Loading records…" />
          )}
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
              isAdmin={isAdmin || sheetManager}
              canDeleteAny={isAdmin}
              onRecordChanged={replaceRecord}
              onDelete={(record) => void removeRecord(record)}
            />
          )}
        </div>
        {selected === "new" && (
          <RecordSidebar
            key="new"
            tableId={table.id}
            fields={fields}
            record={null}
            currentUserId={me}
            canCreate={canEdit}
            onCreate={sheet ? (data) => createSheetRecord(sheet.id, data) : undefined}
            givenTo={sheet?.owner.full_name}
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
            fields={fields}
            record={selectedRecord}
            currentUserId={me}
            canCreate={canEdit}
            isAdmin={isAdmin || sheetManager}
            reviewer={sheetManager}
            tableEditor={!sheet && canEdit}
            admin={isAdmin}
            onSaved={replaceRecord}
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
